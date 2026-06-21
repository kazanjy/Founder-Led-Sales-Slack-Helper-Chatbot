import { prisma } from "@/lib/db";
import type { Deal } from "@prisma/client";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { getSlackClient } from "@/lib/slack/client";
import { ensurePotentialDealForDomain, getSelfDomains } from "@/lib/deals/auto-detect";
import { withRecorderTokenRefresh } from "@/lib/meeting-recorder/auth";

/**
 * Hourly scanner that watches each user's connected call recorder
 * for new recordings and either (a) attaches them to a matching
 * existing deal as a "Meeting" timeline entry or (b) spins up a
 * new "Potential" deal for the user to validate or dismiss.
 *
 * Dedupe is via processed_recordings (unique on userId +
 * providerCallId). Domain matching for "which existing deal does
 * this call belong to" is purely client-side from attendee emails.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

export interface ScanSummary {
  userId: string;
  scanned: number;
  attached: number;
  potentials: number;
  skipped: number;
  errors: number;
  // IDs of EXISTING deals that got a new call_summary entry attached
  // during this scan. The cron route uses this to fire one
  // runDealAnalysis per deal via after() so the deal's Mikey Health /
  // next-step suggestions factor in the new evidence. Newly-created
  // Potential deals are intentionally excluded — they re-analyze when
  // the user clicks Validate, and burning tokens before the user has
  // even confirmed the deal is wasteful.
  attachedExistingDealIds: string[];
}

function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/^www\./, "");
  return d || null;
}

// Self-domain + existing-deal lookups now live in lib/deals/auto-detect.ts so
// the calendar pipeline can reuse the same dedup contract.

interface PostedAlert {
  channelId: string;
  ts: string;
}

async function openMikeyDm(workspaceBotToken: string, slackUserId: string): Promise<string | null> {
  try {
    const client = getSlackClient(workspaceBotToken);
    const opened = await client.conversations.open({ users: slackUserId });
    return opened.channel?.id || null;
  } catch (err) {
    console.error("[scan-recordings] conversations.open failed:", err);
    return null;
  }
}

async function postPotentialDealAlert(opts: {
  botToken: string;
  channelId: string;
  appUrl: string;
  deal: Deal;
  call: {
    title: string;
    date: string;
    summary?: string;
    attendees: Array<{ name: string; email?: string }>;
    url?: string;
  };
}): Promise<PostedAlert | null> {
  const client = getSlackClient(opts.botToken);
  const dealUrl = `${opts.appUrl}/deals/${opts.deal.id}`;
  const date = new Date(opts.call.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const attendeeLine = opts.call.attendees
    .map((a) => (a.email ? `${a.name} <mailto:${a.email}|${a.email}>` : a.name))
    .join(", ");
  const summary = opts.call.summary
    ? opts.call.summary.length > 600
      ? opts.call.summary.slice(0, 600).trimEnd() + "…"
      : opts.call.summary
    : "";
  try {
    const result = await client.chat.postMessage({
      channel: opts.channelId,
      mrkdwn: true,
      text: `New potential deal: ${opts.deal.companyName}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🆕 Potential deal: ${opts.deal.companyName}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `We picked up a new call that doesn't match any existing deal:\n\n` +
              `📞 *${opts.call.title}*\n🕒 ${date}\n👥 ${attendeeLine}` +
              (opts.call.url ? `\n🔗 <${opts.call.url}|Recording>` : ""),
          },
        },
        ...(summary
          ? [{
              type: "section" as const,
              text: { type: "mrkdwn" as const, text: `> ${summary.replace(/\n/g, "\n> ")}` },
            }]
          : []),
        {
          type: "section",
          text: { type: "mrkdwn", text: `<${dealUrl}|Open deal →>` },
        },
        {
          type: "actions",
          block_id: `potential_deal_actions:${opts.deal.id}`,
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "✓ Validate" },
              value: opts.deal.id,
              action_id: "validate_potential_deal",
            },
            {
              type: "button",
              style: "danger",
              text: { type: "plain_text", text: "✕ Dismiss" },
              value: opts.deal.id,
              action_id: "dismiss_potential_deal",
            },
          ],
        },
      ],
    });
    return { channelId: opts.channelId, ts: result.ts || "" };
  } catch (err) {
    console.error("[scan-recordings] potential-deal post failed:", err);
    return null;
  }
}

async function postMeetingAttachedAlert(opts: {
  botToken: string;
  channelId: string;
  appUrl: string;
  deal: Deal;
  call: { title: string; date: string; url?: string };
}): Promise<void> {
  const client = getSlackClient(opts.botToken);
  const dealUrl = `${opts.appUrl}/deals/${opts.deal.id}`;
  const date = new Date(opts.call.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  try {
    await client.chat.postMessage({
      channel: opts.channelId,
      mrkdwn: true,
      text: `New meeting added to ${opts.deal.name}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `🗓 Added a new meeting to *${opts.deal.name}*:\n` +
              `*${opts.call.title}* — ${date}` +
              (opts.call.url ? ` · <${opts.call.url}|Recording>` : "") +
              `\n\n<${dealUrl}|Open deal →>`,
          },
        },
      ],
    });
  } catch (err) {
    console.error("[scan-recordings] attached-meeting post failed:", err);
  }
}

/**
 * Scan one user's recorder and process anything new. Idempotent —
 * already-processed calls are skipped via the processed_recordings
 * unique index.
 */
export async function scanUserRecordings(userId: string): Promise<ScanSummary> {
  const out: ScanSummary = { userId, scanned: 0, attached: 0, potentials: 0, skipped: 0, errors: 0, attachedExistingDealIds: [] };
  const attachedSet = new Set<string>();

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) return out;

  const provider = getProvider(conn.provider);
  if (!provider) return out;

  let calls;
  try {
    // Bumped from 50 → 75 because founders typically run ~10 calls/week
    // and a daily sweep at 50 leaves zero headroom for a missed run or a
    // burst week. 75 is ~1.5 weeks of coverage at typical volume.
    calls = await withRecorderTokenRefresh(conn, (apiKey) => provider.listCalls(apiKey, 75));
  } catch (err) {
    console.error(`[scan-recordings] ${conn.provider} listCalls failed for ${userId}:`, err);
    out.errors++;
    return out;
  }
  out.scanned = calls.length;

  if (calls.length === 0) return out;

  // Dedupe: drop any callIds we've already processed for this user.
  const callIds = calls.map((c) => c.id);
  const alreadyDone = await prisma.processedRecording.findMany({
    where: { userId, providerCallId: { in: callIds } },
    select: { providerCallId: true },
  });
  const doneSet = new Set(alreadyDone.map((r) => r.providerCallId));
  const fresh = calls.filter((c) => !doneSet.has(c.id));
  if (fresh.length === 0) return out;

  const self = await getSelfDomains(userId);

  // Slack target: user's MikeyBot DM. Resolved once per user.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { workspaceId: true, slackUserId: true },
  });
  let botToken: string | null = null;
  let dmChannelId: string | null = null;
  if (userRow?.workspaceId && userRow.slackUserId) {
    const ws = await prisma.workspace.findUnique({
      where: { id: userRow.workspaceId },
      select: { botToken: true },
    });
    if (ws?.botToken) {
      botToken = ws.botToken;
      dmChannelId = await openMikeyDm(ws.botToken, userRow.slackUserId);
    }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

  for (const call of fresh) {
    try {
      const attendeeDomains = (call.attendees || [])
        .map((a) => domainFromEmail(a.email))
        .filter(Boolean) as string[];
      const externalDomains = attendeeDomains.filter(
        (d) => !self.has(d) && !PUBLIC_EMAIL_DOMAINS.has(d)
      );

      if (externalDomains.length === 0) {
        await prisma.processedRecording.create({
          data: {
            userId,
            provider: conn.provider,
            providerCallId: call.id,
            result: "skipped_internal_only",
          },
        });
        out.skipped++;
        continue;
      }

      // Use the shared helper to pick the target deal — handles "attach to
      // existing active/potential", "skip if cooldown hit on a dismissed
      // deal", and "create new Potential" with one consistent contract.
      const primaryDomain = externalDomains[0];
      const detection = await ensurePotentialDealForDomain({
        userId,
        domain: primaryDomain,
        source: "recorder",
        selfDomains: self,
      });

      if (detection.kind === "cooldown_hit") {
        // Recently-dismissed deal for this domain — don't reattach.
        await prisma.processedRecording.create({
          data: {
            userId,
            provider: conn.provider,
            providerCallId: call.id,
            result: "skipped_cooldown",
            dealId: detection.deal.id,
          },
        });
        out.skipped++;
        continue;
      }

      if (!detection.deal) {
        // skipped_internal / skipped_public_domain — shouldn't happen here
        // since we already filtered externalDomains, but be defensive.
        await prisma.processedRecording.create({
          data: {
            userId,
            provider: conn.provider,
            providerCallId: call.id,
            result: detection.kind,
          },
        });
        out.skipped++;
        continue;
      }

      const deal = detection.deal;
      const isNew = detection.kind === "created_potential";

      const detail = await withRecorderTokenRefresh(conn, (apiKey) =>
        provider.getCallDetail(apiKey, call.id)
      );
      const content =
        (detail.summary ? `**Summary**\n${detail.summary}\n\n` : "") +
        (detail.transcript ? `**Transcript**\n${detail.transcript}` : "");
      const entry = await prisma.dealTimelineEntry.create({
        data: {
          dealId: deal.id,
          type: "call_summary",
          title: call.title,
          content,
          sourceUrl: call.providerUrl || null,
          entryDate: new Date(call.date),
          metadata: JSON.stringify({
            auto_imported: true,
            provider: conn.provider,
            providerCallId: call.id,
            participants: call.participants || [],
            // Captured so the post-enrich back-link pass on validation
            // can resolve attendees → DealParticipant ids and write
            // linkedParticipantIds for the "With <names>" row.
            attendeeEmails: (call.attendees || [])
              .map((a) => a.email?.trim().toLowerCase())
              .filter((e): e is string => !!e),
          }),
        },
      });

      if (isNew) {
        for (const a of call.attendees || []) {
          const d = domainFromEmail(a.email);
          if (!d || self.has(d) || PUBLIC_EMAIL_DOMAINS.has(d)) continue;
          await prisma.dealParticipant.create({
            data: { dealId: deal.id, name: a.name, email: a.email },
          });
        }
      }

      await prisma.processedRecording.create({
        data: {
          userId,
          provider: conn.provider,
          providerCallId: call.id,
          result: isNew ? "created_potential" : "attached_existing",
          dealId: deal.id,
          notes: isNew ? null : entry.id,
        },
      });
      if (isNew) {
        out.potentials++;
      } else {
        out.attached++;
        // Track for post-scan re-analysis. Dedupes via Set so a deal
        // that gets multiple calls landed in the same tick only
        // triggers one analyzer run.
        attachedSet.add(deal.id);
      }

      if (botToken && dmChannelId) {
        if (isNew) {
          await postPotentialDealAlert({
            botToken,
            channelId: dmChannelId,
            appUrl,
            deal,
            call: {
              title: call.title,
              date: call.date,
              summary: detail.summary,
              attendees: (call.attendees || []).map((a) => ({ name: a.name, email: a.email })),
              url: call.providerUrl,
            },
          });
        } else {
          await postMeetingAttachedAlert({
            botToken,
            channelId: dmChannelId,
            appUrl,
            deal,
            call: { title: call.title, date: call.date, url: call.providerUrl },
          });
        }
      }
    } catch (err) {
      console.error(`[scan-recordings] processing failed for call ${call.id}:`, err);
      out.errors++;
    }
  }

  await prisma.meetingRecorderConnection.update({
    where: { id: conn.id },
    data: { lastSyncedAt: new Date() },
  });
  out.attachedExistingDealIds = Array.from(attachedSet);
  return out;
}
