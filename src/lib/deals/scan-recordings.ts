import { prisma } from "@/lib/db";
import {
  confirmDealFromCall,
  dealHasHumanTouch,
  postDealConfirmedStub,
  postDealDismissedStub,
  recordConfirmationTriage,
} from "@/lib/deals/triage";
import type { Deal } from "@prisma/client";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { getSlackClient } from "@/lib/slack/client";
import { ensurePotentialDealForDomain, getSelfDomains, getAccountUserEmails } from "@/lib/deals/auto-detect";
import { isAlertEnabled, alertFooterBlock } from "@/lib/deals/alert-prefs";
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
        alertFooterBlock("new_deal", opts.appUrl),
      ],
    });
    return { channelId: opts.channelId, ts: result.ts || "" };
  } catch (err) {
    console.error("[scan-recordings] potential-deal post failed:", err);
    return null;
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

  // Scan every active recorder the user has connected — not just one.
  // Same physical meeting captured by two recorders gets two different
  // providerCallIds, so it lands as two timeline entries. We accept
  // that for now; users rarely run multiple recorders simultaneously.
  const conns = await prisma.meetingRecorderConnection.findMany({
    where: { userId, status: "active" },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (conns.length === 0) return out;

  // Hoist out shared per-user setup so we don't repeat it per provider.
  const self = await getSelfDomains(userId);
  // Internal Mikey user emails (the seller + any teammates in the
  // same account). Used to keep sellers off of deals as
  // "participants" — important when the seller's own email is on
  // gmail.com or another public domain that the self-domain check
  // can't catch.
  const internalEmails = await getAccountUserEmails(userId);

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

  for (const conn of conns) {
    const provider = getProvider(conn.provider);
    if (!provider) continue;

    let calls;
    try {
      // 75 calls ≈ 1.5 weeks of coverage at ~10 calls/week — leaves
      // headroom for a missed run or a burst week.
      calls = await withRecorderTokenRefresh(conn, (apiKey) => provider.listCalls(apiKey, 75));
    } catch (err) {
      console.error(`[scan-recordings] ${conn.provider} listCalls failed for ${userId}:`, err);
      out.errors++;
      continue;
    }
    out.scanned += calls.length;

    if (calls.length === 0) {
      // Still bump lastSyncedAt so we know the cron made contact even
      // when there were no new calls to fetch.
      await prisma.meetingRecorderConnection.update({
        where: { id: conn.id },
        data: { lastSyncedAt: new Date() },
      }).catch(() => {});
      continue;
    }

    // Dedupe: drop any callIds we've already processed for this user.
    // Two sources of truth — both have to be consulted because manual
    // imports (the bulk-import flow, pasted entries) write straight to
    // dealTimelineEntry.metadata.providerCallId WITHOUT leaving a
    // processedRecording row. Looking only at processed_recordings
    // would re-import every call the user already imported by hand.
    // Scoped to this provider — providerCallIds aren't unique across
    // providers, so a Fathom id "abc" and a Circleback id "abc" would
    // be unrelated. processedRecording's unique index covers
    // (userId, providerCallId) anyway; we filter at the JS level.
    const callIds = calls.map((c) => c.id);
    const [alreadyDone, manualEntries] = await Promise.all([
      prisma.processedRecording.findMany({
        where: { userId, provider: conn.provider, providerCallId: { in: callIds } },
        select: { providerCallId: true },
      }),
      prisma.dealTimelineEntry.findMany({
        where: {
          deal: { userId },
          type: { in: ["call_summary", "call_transcript"] },
        },
        select: { metadata: true },
      }),
    ]);
    const doneSet = new Set<string>(alreadyDone.map((r) => r.providerCallId));
    for (const e of manualEntries) {
      if (!e.metadata) continue;
      try {
        const m = JSON.parse(e.metadata) as { provider?: unknown; providerCallId?: unknown };
        // Only treat the manual entry as "done" for this provider if
        // its metadata.provider matches — different providers issue
        // different IDs for the same physical call.
        if (
          typeof m.providerCallId === "string" &&
          m.providerCallId.trim() &&
          (typeof m.provider !== "string" || m.provider === conn.provider)
        ) {
          doneSet.add(m.providerCallId.trim());
        }
      } catch { /* ignore */ }
    }
    const fresh = calls.filter((c) => !doneSet.has(c.id));
    if (fresh.length === 0) {
      await prisma.meetingRecorderConnection.update({
        where: { id: conn.id },
        data: { lastSyncedAt: new Date() },
      }).catch(() => {});
      continue;
    }

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

      if (detection.kind === "customer_call") {
        // Closed-won account — a customer conversation, not pipeline.
        // Stays off the deals entirely; the Customer Success applet
        // will own post-close call logging.
        await prisma.processedRecording.create({
          data: {
            userId,
            provider: conn.provider,
            providerCallId: call.id,
            result: "skipped_customer_call",
            dealId: detection.deal.id,
          },
        });
        out.skipped++;
        continue;
      }

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
          // Belt-and-suspenders: even if the domain check let the
          // email through, drop it when the address belongs to a
          // Mikey user in this account. Catches sellers / teammates
          // whose email lives on a custom domain that didn't make
          // the public-domain list.
          const emailLower = a.email?.trim().toLowerCase();
          if (emailLower && internalEmails.has(emailLower)) continue;
          await prisma.dealParticipant.create({
            data: { dealId: deal.id, name: a.name, email: a.email },
          });
        }
      }

      // ── Deal autopilot Pass 2: post-meeting confirmation ──────
      // New deals and calendar-triaged "likely" deals get the true
      // determination from the transcript instead of waiting for a
      // human Validate click (deal-autopilot-plan.md). Classifier
      // failure degrades to the legacy behavior (potential + buttons)
      // so a model outage never strands calls.
      const needsConfirmation = isNew || deal.status === "likely";
      let confirmationOutcome: "confirmed" | "dismissed" | "kept" | "fallback" = "fallback";
      if (needsConfirmation && content.trim()) {
        try {
          const priorTriage = await prisma.dealTriage.findFirst({
            where: { userId, dealId: deal.id, verdict: "likely_deal" },
            select: { reason: true },
          });
          const verdict = await confirmDealFromCall(userId, {
            companyName: deal.companyName || deal.name,
            callTitle: call.title,
            callContent: content,
            priorTriageReason: priorTriage?.reason,
          });
          await recordConfirmationTriage({
            userId,
            sourceId: call.id,
            eventAt: new Date(call.date),
            title: call.title,
            verdict: verdict.verdict,
            confidence: verdict.confidence,
            reason: verdict.reason,
            dealId: deal.id,
          });

          if (verdict.verdict === "confirmed_deal") {
            await prisma.deal.update({
              where: { id: deal.id },
              data: {
                status: "active",
                ...(verdict.stage ? { stage: verdict.stage } : {}),
              },
            });
            confirmationOutcome = "confirmed";
            attachedSet.add(deal.id); // analysis cascade
            await postDealConfirmedStub({
              userId,
              dealId: deal.id,
              companyName: deal.companyName || deal.name,
              callTitle: call.title,
              stage: verdict.stage,
              reason: verdict.reason,
              isNewDeal: isNew,
            });
          } else if (isNew) {
            // Fresh call that isn't a deal: archive quietly (the
            // dismissed row also feeds the domain cooldown so we
            // don't re-create next week). No Slack noise for vendor
            // calls the founder never heard about.
            await prisma.deal.update({
              where: { id: deal.id },
              data: { status: "dismissed" },
            });
            confirmationOutcome = "dismissed";
          } else {
            // A watched likely deal judged not-a-deal. The absolute
            // rule: human-touched deals are never auto-dismissed.
            const touched = await dealHasHumanTouch(deal.id);
            if (touched) {
              confirmationOutcome = "kept";
            } else {
              await prisma.deal.update({
                where: { id: deal.id },
                data: { status: "dismissed" },
              });
              confirmationOutcome = "dismissed";
              await postDealDismissedStub({
                userId,
                dealId: deal.id,
                companyName: deal.companyName || deal.name,
                reason: verdict.reason,
              });
            }
          }
        } catch (err) {
          console.error(`[scan-recordings] confirmation failed for ${call.id}:`, err);
          confirmationOutcome = "fallback";
        }
      }

      await prisma.processedRecording.create({
        data: {
          userId,
          provider: conn.provider,
          providerCallId: call.id,
          result: needsConfirmation
            ? confirmationOutcome === "confirmed"
              ? "confirmed_active"
              : confirmationOutcome === "dismissed"
                ? "auto_dismissed"
                : confirmationOutcome === "kept"
                  ? "kept_human_touch"
                  : isNew
                    ? "created_potential"
                    : "attached_existing"
            : isNew
              ? "created_potential"
              : "attached_existing",
          dealId: deal.id,
          notes: isNew ? null : entry.id,
        },
      });
      if (isNew && confirmationOutcome === "fallback") {
        out.potentials++;
      } else if (!isNew) {
        out.attached++;
        // Track for post-scan re-analysis. Dedupes via Set so a deal
        // that gets multiple calls landed in the same tick only
        // triggers one analyzer run.
        attachedSet.add(deal.id);
      }

      if (botToken && dmChannelId) {
        if (isNew && confirmationOutcome === "fallback" && (await isAlertEnabled(userId, "new_deal"))) {
          // Legacy path — classifier unavailable, fall back to the
          // Validate/Dismiss flow so nothing gets lost.
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
        }
        // Attached-to-existing calls no longer get the legacy
        // "meeting added" DM — the analysis cascade posts the
        // "🧠 Updated Deal Analysis" stub to the claimed channel a
        // few minutes later (or a "call attached" one-liner when
        // the re-analysis cooldown skips), per autopilot Phase 3.
      }
    } catch (err) {
      console.error(`[scan-recordings] processing failed for call ${call.id}:`, err);
      out.errors++;
    }
    }

    await prisma.meetingRecorderConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: new Date() },
    }).catch(() => {});
  }

  // ── Backfill / self-heal (deal-autopilot Phase 2) ─────────────────
  // Two populations flow through the same confirmation classifier:
  //  - legacy "potential" deals still sitting in the Validate/Dismiss
  //    queue (one-time migration, drained gradually), and
  //  - "likely" deals whose in-tick confirmation failed (classifier
  //    outage) but that have call content attached.
  // Up to 2 per user per tick; a triage row (backfill:<dealId>) marks
  // the attempt so each deal is judged at most once.
  try {
    const candidates = await prisma.deal.findMany({
      where: {
        userId,
        status: { in: ["potential", "likely"] },
        createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
        entries: { some: { type: { in: ["call_summary", "call_transcript"] } } },
      },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, name: true, companyName: true, status: true },
    });
    let processed = 0;
    for (const deal of candidates) {
      if (processed >= 2) break;
      const already = await prisma.dealTriage.findUnique({
        where: {
          userId_source_sourceId: {
            userId,
            source: "recording",
            sourceId: `backfill:${deal.id}`,
          },
        },
        select: { id: true },
      });
      if (already) continue;
      const callEntry = await prisma.dealTimelineEntry.findFirst({
        where: { dealId: deal.id, type: { in: ["call_summary", "call_transcript"] } },
        orderBy: { entryDate: "desc" },
        select: { title: true, content: true, entryDate: true },
      });
      if (!callEntry?.content?.trim()) continue;
      processed++;
      try {
        const verdict = await confirmDealFromCall(userId, {
          companyName: deal.companyName || deal.name,
          callTitle: callEntry.title || "Recorded call",
          callContent: callEntry.content,
        });
        await recordConfirmationTriage({
          userId,
          sourceId: `backfill:${deal.id}`,
          eventAt: callEntry.entryDate,
          title: callEntry.title || "Recorded call",
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          reason: verdict.reason,
          dealId: deal.id,
        });
        if (verdict.verdict === "confirmed_deal") {
          await prisma.deal.update({
            where: { id: deal.id },
            data: { status: "active", ...(verdict.stage ? { stage: verdict.stage } : {}) },
          });
          attachedSet.add(deal.id);
          await postDealConfirmedStub({
            userId,
            dealId: deal.id,
            companyName: deal.companyName || deal.name,
            callTitle: callEntry.title || "Recorded call",
            stage: verdict.stage,
            reason: verdict.reason,
            isNewDeal: false,
          });
        } else {
          const touched = await dealHasHumanTouch(deal.id);
          if (!touched) {
            await prisma.deal.update({
              where: { id: deal.id },
              data: { status: "dismissed" },
            });
            // Likely deals were announced — tell the founder they died.
            // Legacy potentials resolve quietly (their Validate post is
            // already stale in the channel).
            if (deal.status === "likely") {
              await postDealDismissedStub({
                userId,
                dealId: deal.id,
                companyName: deal.companyName || deal.name,
                reason: verdict.reason,
              });
            }
          }
        }
        console.log(
          `[scan-recordings] backfill triage ${deal.id} (${deal.status}) → ${verdict.verdict}`
        );
      } catch (err) {
        console.error(`[scan-recordings] backfill triage failed for ${deal.id}:`, err);
      }
    }
  } catch (err) {
    console.error(`[scan-recordings] backfill sweep failed for ${userId}:`, err);
  }

  out.attachedExistingDealIds = Array.from(attachedSet);
  return out;
}
