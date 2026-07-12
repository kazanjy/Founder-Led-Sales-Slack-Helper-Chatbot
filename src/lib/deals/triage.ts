import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";
import { loadSellerContext } from "@/lib/seller-context";
import type { UnmatchedCalendarEvent } from "./scan-future-meetings";

/**
 * Deal autopilot — Pass 1: pre-meeting calendar triage
 * (deal-autopilot-plan.md). Classifies calendar events that matched no
 * existing deal as likely_deal / unlikely_deal from the invite content
 * + attendees + the founder's ICP and positioning. Likely verdicts
 * auto-create a REAL deal (status "likely") with participants and the
 * meeting attached, and announce via a Slack stub post with a
 * "Not a deal?" escape hatch. Every judgment lands in DealTriage —
 * dedupe guard, audit trail, and digest source.
 */

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

// Below this, a likely-looking event is logged as borderline-unlikely
// instead of auto-creating a deal. A false "new deal!" post costs
// founder trust faster than a miss the digest can catch.
const CONFIDENCE_THRESHOLD = 0.7;

export interface TriageVerdict {
  verdict: "likely_deal" | "unlikely_deal";
  category: string;
  confidence: number;
  companyName: string | null;
  companyDomain: string | null;
  reason: string;
}

const TRIAGE_PROMPT = `You are the deal-detection triage for a founder doing founder-led sales. Given ONE upcoming calendar event (title, description, attendees) plus the founder's positioning and ICP, judge whether this meeting is likely the start (or continuation) of a SALES OPPORTUNITY where the founder is the SELLER.

Return ONLY a JSON object:
{
  "verdict": "likely_deal" | "unlikely_deal",
  "category": "prospect_first_call" | "existing_customer" | "vendor_pitch_to_us" | "fundraising" | "recruiting" | "internal" | "personal" | "unknown",
  "confidence": 0.0-1.0,
  "companyName": "<the prospect company's name, best effort, or null>",
  "companyDomain": "<the prospect company's email domain, or null>",
  "reason": "<1-2 sentences, specific>"
}

Judgment rules:
- LIKELY: external attendees from one company that plausibly fits the founder's ICP, plus meeting language that reads like an intro / demo / discovery / evaluation ("intro", "<CompanyA> <> <CompanyB>", "demo", "sync re: evaluation", a shared agenda about the founder's problem space).
- UNLIKELY signals — classify by what the meeting IS:
  - vendor_pitch_to_us: the founder is the BUYER (someone selling tools/services TO them).
  - fundraising: investor patterns — partners/principals at funds, "catch up", "intro to <VC>".
  - recruiting: candidates, interviews, "chat re: role".
  - internal / personal: no genuine external prospect present.
- The prospect company is the EXTERNAL attendees' company — never the founder's own.
- Low information (empty description, unknown domain, ambiguous title) → unlikely/unknown with low confidence. NEVER guess a company into existence.
- Be conservative: when torn, unlikely with your honest confidence. The founder can promote from the digest; a wrong "new deal" announcement is worse.`;

async function internalDomains(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, accountId: true },
  });
  const domains = new Set<string>();
  const add = (email: string | null | undefined) => {
    const at = (email || "").indexOf("@");
    if (at > 0) domains.add((email || "").slice(at + 1).toLowerCase());
  };
  add(user?.email);
  if (user?.accountId) {
    const teammates = await prisma.user.findMany({
      where: { accountId: user.accountId },
      select: { email: true },
    });
    for (const t of teammates) add(t.email);
  }
  return domains;
}

/**
 * Classify one unmatched calendar event. Returns null when the event
 * has no genuinely external attendees (cheap pre-filter — no LLM call).
 */
export async function classifyCalendarEvent(
  userId: string,
  event: UnmatchedCalendarEvent
): Promise<TriageVerdict | null> {
  const internal = await internalDomains(userId);
  const external = event.attendees.filter((a) => {
    const at = a.email.indexOf("@");
    if (at < 0) return false;
    const d = a.email.slice(at + 1).toLowerCase();
    return !internal.has(d) && !PUBLIC_EMAIL_DOMAINS.has(d);
  });
  if (external.length === 0) return null;

  const seller = await loadSellerContext(userId);
  const icpVersion = await prisma.icpVersion.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  let icpText = "";
  if (icpVersion) {
    try {
      const parsed = JSON.parse(icpVersion.content) as {
        sections?: Array<{ name?: string; items?: string[] }>;
      };
      icpText = (parsed.sections || [])
        .filter((s) => s.items?.length)
        .map((s) => `${s.name}: ${s.items!.join("; ")}`)
        .join("\n")
        .substring(0, 4000);
    } catch { /* proceed without */ }
  }

  const payload = {
    event: {
      title: event.title,
      startsAt: event.startsAt,
      description: event.description,
      attendees: event.attendees,
      externalAttendees: external,
    },
    foundersInternalDomains: [...internal],
    foundersValueProp: seller.valueProp100w?.substring(0, 1500) || "(none)",
    foundersIcp: icpText || "(none authored)",
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${TRIAGE_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: Partial<TriageVerdict>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Triage classifier returned unparseable JSON");
  }
  if (parsed.verdict !== "likely_deal" && parsed.verdict !== "unlikely_deal") {
    throw new Error("Triage classifier returned an invalid verdict");
  }
  return {
    verdict: parsed.verdict,
    category: typeof parsed.category === "string" ? parsed.category : "unknown",
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    companyName: typeof parsed.companyName === "string" && parsed.companyName ? parsed.companyName : null,
    companyDomain:
      typeof parsed.companyDomain === "string" && parsed.companyDomain
        ? parsed.companyDomain.toLowerCase().replace(/^www\./, "")
        : null,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function nameFromEmailLocal(email: string): string {
  const local = email.split("@")[0] || email;
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

/**
 * Create the real deal for a likely verdict: participants from the
 * external attendees, the meeting on the timeline (with
 * calendarEventId so the 5-min sweep dedupes), status "likely".
 */
export async function createLikelyDeal(
  userId: string,
  event: UnmatchedCalendarEvent,
  verdict: TriageVerdict
): Promise<{ dealId: string }> {
  const internal = await internalDomains(userId);
  const companyName =
    verdict.companyName ||
    (verdict.companyDomain ? verdict.companyDomain.split(".")[0] : null) ||
    "Unknown Company";

  const deal = await prisma.deal.create({
    data: {
      userId,
      name: `${companyName} — New Business`,
      companyName,
      companyUrl: verdict.companyDomain,
      stage: "prospecting",
      status: "likely",
      source: "calendar_triage",
    },
  });

  // External attendees become participants (prospect-side only).
  for (const a of event.attendees) {
    const at = a.email.indexOf("@");
    if (at < 0) continue;
    const d = a.email.slice(at + 1).toLowerCase();
    if (internal.has(d) || PUBLIC_EMAIL_DOMAINS.has(d)) continue;
    try {
      await prisma.dealParticipant.create({
        data: {
          dealId: deal.id,
          name: a.name || nameFromEmailLocal(a.email),
          email: a.email,
          role: "unknown",
        },
      });
    } catch (err) {
      console.error(`[triage] participant create failed (${a.email}):`, err);
    }
  }

  // The triggering meeting lands on the timeline — same shape the
  // calendar sweep writes, so it dedupes on subsequent ticks.
  await prisma.dealTimelineEntry.create({
    data: {
      dealId: deal.id,
      type: "meeting",
      title: event.title,
      content: event.description || "(no description)",
      sourceUrl: event.htmlLink,
      entryDate: new Date(event.startsAt),
      metadata: JSON.stringify({
        auto_imported: true,
        source: "calendar_triage",
        calendarEventId: event.calendarEventId,
        futureAtImport: true,
        attendeeEmails: event.attendees.map((a) => a.email),
      }),
    },
  });

  return { dealId: deal.id };
}

/**
 * "🎯 New Deal Detected" stub post — claimed channel first, MikeyBot
 * DM fallback. Scannable preview + [Open deal] + "Not a deal?" escape
 * hatch. Best-effort: Slack being down never blocks deal creation.
 */
export async function postLikelyDealStub(opts: {
  userId: string;
  dealId: string;
  companyName: string;
  event: UnmatchedCalendarEvent;
  reason: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { workspaceId: true, slackUserId: true },
  });
  if (!user?.workspaceId) return;
  const ws = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!ws?.botToken) return;
  const client = getSlackClient(ws.botToken);

  // Claimed channel (most recently active) beats DM.
  const claim = await prisma.channelClaim.findFirst({
    where: { claimedByUserId: opts.userId },
    orderBy: { lastMessageAt: "desc" },
    select: { slackChannelId: true },
  });
  let channelId = claim?.slackChannelId || null;
  if (!channelId && user.slackUserId) {
    try {
      const opened = await client.conversations.open({ users: user.slackUserId });
      channelId = opened.channel?.id || null;
    } catch { /* no target — skip */ }
  }
  if (!channelId) return;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");
  const when = new Date(opts.event.startsAt).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const attendeeLine = opts.event.attendees
    .map((a) => a.name || a.email)
    .slice(0, 6)
    .join(", ");

  try {
    await client.chat.postMessage({
      channel: channelId,
      mrkdwn: true,
      text: `New deal detected: ${opts.companyName}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🎯 New Deal Detected: ${opts.companyName}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Spotted on your calendar — I've set the deal up and started working it.\n\n` +
              `📅 *${opts.event.title}*\n🕒 ${when}\n👥 ${attendeeLine}\n\n_${opts.reason}_`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `<${appUrl}/deals/${opts.dealId}|Open deal →>` },
        },
        {
          type: "actions",
          block_id: `likely_deal_actions:${opts.dealId}`,
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✕ Not a deal" },
              value: opts.dealId,
              action_id: "dismiss_likely_deal",
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("[triage] likely-deal stub post failed:", err);
  }
}

export interface TriageTickResult {
  classified: number;
  likely: number;
  unlikely: number;
  errors: number;
}

/**
 * Triage a user's unmatched calendar events — called from the 5-min
 * cron after the sweep. Caps LLM classifications per tick; DealTriage
 * rows dedupe permanently, so the backlog drains across ticks.
 */
export async function triageUnmatchedEvents(
  userId: string,
  events: UnmatchedCalendarEvent[],
  maxClassifications = 3
): Promise<TriageTickResult> {
  const out: TriageTickResult = { classified: 0, likely: 0, unlikely: 0, errors: 0 };
  if (events.length === 0) return out;

  // Drop events already triaged (the permanent dedupe).
  const seen = await prisma.dealTriage.findMany({
    where: {
      userId,
      source: "calendar",
      sourceId: { in: events.map((e) => e.calendarEventId) },
    },
    select: { sourceId: true },
  });
  const seenIds = new Set(seen.map((s) => s.sourceId));
  const fresh = events.filter((e) => !seenIds.has(e.calendarEventId));

  for (const event of fresh.slice(0, maxClassifications)) {
    try {
      const verdict = await classifyCalendarEvent(userId, event);
      if (!verdict) {
        // No external attendees — record as internal so we never
        // reconsider it.
        await prisma.dealTriage.create({
          data: {
            userId,
            source: "calendar",
            sourceId: event.calendarEventId,
            eventAt: new Date(event.startsAt),
            title: event.title,
            verdict: "unlikely_deal",
            category: "internal",
            confidence: 1,
            reason: "No external attendees.",
          },
        });
        continue;
      }
      out.classified++;

      const isLikely =
        verdict.verdict === "likely_deal" && verdict.confidence >= CONFIDENCE_THRESHOLD;
      const borderline =
        verdict.verdict === "likely_deal" && verdict.confidence < CONFIDENCE_THRESHOLD;

      let dealId: string | null = null;
      if (isLikely) {
        const created = await createLikelyDeal(userId, event, verdict);
        dealId = created.dealId;
        out.likely++;
        await postLikelyDealStub({
          userId,
          dealId,
          companyName: verdict.companyName || "New prospect",
          event,
          reason: verdict.reason,
        });
      } else {
        out.unlikely++;
      }

      await prisma.dealTriage.create({
        data: {
          userId,
          source: "calendar",
          sourceId: event.calendarEventId,
          eventAt: new Date(event.startsAt),
          title: event.title,
          verdict: isLikely ? "likely_deal" : "unlikely_deal",
          category: verdict.category,
          confidence: verdict.confidence,
          borderline,
          reason: verdict.reason,
          dealId,
        },
      });
    } catch (err) {
      out.errors++;
      console.error(`[triage] event ${event.calendarEventId} failed:`, err);
    }
  }
  return out;
}
