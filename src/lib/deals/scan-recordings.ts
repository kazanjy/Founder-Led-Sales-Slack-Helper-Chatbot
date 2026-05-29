import { prisma } from "@/lib/db";
import type { Deal } from "@prisma/client";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { getSlackClient } from "@/lib/slack/client";

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

interface ScanSummary {
  userId: string;
  scanned: number;
  attached: number;
  potentials: number;
  skipped: number;
  errors: number;
}

function normalizeDomain(d: string | null | undefined): string {
  return (d || "").trim().toLowerCase().replace(/^www\./, "");
}
function domainFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = normalizeDomain(email.slice(at + 1));
  return d || null;
}
function companyNameFromDomain(domain: string): string {
  const root = domain.split(".")[0] || domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/**
 * Resolve the user's own email domains (account + personal) so we
 * can filter "internal" attendees out before deciding what's
 * external. Returns lowercase, no www.
 */
async function selfDomains(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, slackEmail: true, accountId: true },
  });
  const set = new Set<string>();
  const add = (d: string | null) => {
    if (d) set.add(d);
  };
  add(domainFromEmail(user?.email));
  add(domainFromEmail(user?.slackEmail));
  if (user?.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { emailDomain: true },
    });
    add(normalizeDomain(account?.emailDomain || null));
  }
  return set;
}

/**
 * Domains that the user's existing deals are about, keyed for fast
 * lookup. Maps domain → Deal so when we hit a match we can attach
 * directly. Built from each deal's companyUrl + every participant
 * email's domain.
 */
async function existingDealsByDomain(userId: string): Promise<Map<string, Deal>> {
  const deals = await prisma.deal.findMany({
    where: { userId, status: { notIn: ["dismissed", "closed_lost"] } },
    include: { participants: { select: { email: true } } },
  });
  const map = new Map<string, Deal>();
  for (const deal of deals) {
    const fromUrl = deal.companyUrl
      ? normalizeDomain(deal.companyUrl.replace(/^https?:\/\//i, "").split("/")[0])
      : null;
    if (fromUrl) map.set(fromUrl, deal);
    for (const p of deal.participants) {
      const d = domainFromEmail(p.email);
      if (d) map.set(d, deal);
    }
  }
  return map;
}

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
  const out: ScanSummary = { userId, scanned: 0, attached: 0, potentials: 0, skipped: 0, errors: 0 };

  const conn = await prisma.meetingRecorderConnection.findFirst({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!conn) return out;

  const provider = getProvider(conn.provider);
  if (!provider) return out;

  let calls;
  try {
    calls = await provider.listCalls(conn.accessToken, 50);
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

  const self = await selfDomains(userId);
  const dealByDomain = await existingDealsByDomain(userId);

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
        // Internal-only or unparseable — record and skip.
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

      // Existing deal? Attach the meeting as a timeline entry.
      const matchedDomain = externalDomains.find((d) => dealByDomain.has(d));
      if (matchedDomain) {
        const deal = dealByDomain.get(matchedDomain)!;
        const detail = await provider.getCallDetail(conn.accessToken, call.id);
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
            }),
          },
        });
        await prisma.processedRecording.create({
          data: {
            userId,
            provider: conn.provider,
            providerCallId: call.id,
            result: "attached_existing",
            dealId: deal.id,
            notes: entry.id,
          },
        });
        out.attached++;
        if (botToken && dmChannelId) {
          await postMeetingAttachedAlert({
            botToken,
            channelId: dmChannelId,
            appUrl,
            deal,
            call: { title: call.title, date: call.date, url: call.providerUrl },
          });
        }
        continue;
      }

      // Brand-new external domain — spin up a Potential deal.
      const primaryDomain = externalDomains[0];
      const companyName = companyNameFromDomain(primaryDomain);
      const dealName = `${companyName} — Potential`;
      const newDeal = await prisma.deal.create({
        data: {
          userId,
          name: dealName,
          companyName,
          companyUrl: `https://${primaryDomain}`,
          stage: "prospecting",
          status: "potential",
        },
      });

      // Attach the call as the first timeline entry on the new deal.
      const detail = await provider.getCallDetail(conn.accessToken, call.id);
      const content =
        (detail.summary ? `**Summary**\n${detail.summary}\n\n` : "") +
        (detail.transcript ? `**Transcript**\n${detail.transcript}` : "");
      await prisma.dealTimelineEntry.create({
        data: {
          dealId: newDeal.id,
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
          }),
        },
      });

      // Seed participants from the call's external attendees so the
      // deal isn't empty when the user opens it.
      for (const a of call.attendees || []) {
        const d = domainFromEmail(a.email);
        if (!d || self.has(d) || PUBLIC_EMAIL_DOMAINS.has(d)) continue;
        await prisma.dealParticipant.create({
          data: {
            dealId: newDeal.id,
            name: a.name,
            email: a.email,
          },
        });
      }

      // Update local map so subsequent calls in the same batch
      // attach to this freshly-created deal instead of spawning
      // another potential for the same domain.
      dealByDomain.set(primaryDomain, newDeal);

      await prisma.processedRecording.create({
        data: {
          userId,
          provider: conn.provider,
          providerCallId: call.id,
          result: "created_potential",
          dealId: newDeal.id,
        },
      });
      out.potentials++;

      if (botToken && dmChannelId) {
        await postPotentialDealAlert({
          botToken,
          channelId: dmChannelId,
          appUrl,
          deal: newDeal,
          call: {
            title: call.title,
            date: call.date,
            summary: detail.summary,
            attendees: (call.attendees || []).map((a) => ({ name: a.name, email: a.email })),
            url: call.providerUrl,
          },
        });
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
  return out;
}
