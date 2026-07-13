import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";
import { loadDiscoveryFramework, formatDiscoveryFramework } from "@/lib/discovery-framework";
import { assembleDealEvidence } from "@/lib/business-cases/generate";
import { markdownToSlack } from "@/lib/slack/markdown";
import { resolveSlackTarget, recordDealSlackPost } from "./triage";

/**
 * Deal autopilot Phase 3 — timed Slack stub posts
 * (deal-autopilot-plan.md Part 2). Each key moment in a deal's life
 * gets its own channel-level stub: a scannable preview with a deep
 * link, timed to when the founder actually needs it. Each stub is its
 * own message → its own reply thread (Phase 4 routes replies back to
 * the deal via the DealSlackPost ts→deal mapping).
 *
 * - "📋 New Pre-Call Plan" — ~4h before a meeting on an in-play deal
 *   (enough runway to squeeze in a practice rep, not just skim the
 *   brief). Rides the 5-min scan-future-meetings cron.
 * - "🧠 Updated Deal Analysis" — after the recorder cron's analysis
 *   cascade folds a new recording into the deal.
 * - "🕵 No recording" nudge — a likely deal whose announced meeting
 *   happened 7+ days ago with no call landing since.
 */

const IN_PLAY_STATUSES = ["active", "potential", "likely", "stalled"];

const APP_URL = () =>
  (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");

function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// ── "📋 New Pre-Call Plan" (T-4h) ────────────────────────────────────

// How far ahead of the meeting the pre-call plan stub drops. Four
// hours instead of two so the founder has time to actually run the
// 🥊 practice drills the stub links to, not just read the brief.
const PRECALL_LEAD_HOURS = 4;

interface PreCallBrief {
  synopsis: string;
  objectives: string[];
  watchout: string | null;
}

const PRECALL_BRIEF_PROMPT = `You are prepping a founder-seller for a sales call that starts in a few hours. From the deal evidence, write a terse, concrete pre-call brief.

Return ONLY a JSON object:
{
  "synopsis": "<one sentence — where this deal stands right now>",
  "objectives": ["<3-4 concrete objectives for THIS specific call>"],
  "watchout": "<the single biggest risk or landmine to avoid on this call, one sentence>"
}

Rules:
- Ground everything in the evidence. Reference specific people, commitments, and open questions from prior calls when they exist.
- If evidence is thin (this is the first call), objectives should be discovery-shaped: rapport, agenda + up-front contract, uncovering the problem, qualifying fit.
- Objectives are things the founder DOES on the call, phrased as actions ("Get Maria to commit to introducing the CFO"), not themes.
- Plain text only, no markdown.`;

interface PreCallMeetingInfo {
  title: string;
  startsAt: Date;
  description: string;
  attendees: string[];
}

async function generatePreCallBrief(opts: {
  meeting: PreCallMeetingInfo;
  valueProp: string;
  evidence: string;
}): Promise<PreCallBrief> {
  const payload = {
    meeting: {
      title: opts.meeting.title,
      startsAt: opts.meeting.startsAt.toISOString(),
      description: opts.meeting.description.substring(0, 2000),
      attendees: opts.meeting.attendees,
    },
    foundersValueProp: opts.valueProp?.substring(0, 1500) || "(none)",
    // Newest evidence matters most and assembleDealEvidence orders
    // chronologically — keep the tail.
    dealEvidence: opts.evidence.slice(-40_000),
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${PRECALL_BRIEF_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: Partial<PreCallBrief>;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Pre-call brief generator returned unparseable JSON");
  }
  const objectives = Array.isArray(parsed.objectives)
    ? parsed.objectives.filter((o): o is string => typeof o === "string" && !!o.trim()).slice(0, 4)
    : [];
  if (objectives.length === 0) {
    throw new Error("Pre-call brief generator returned no objectives");
  }
  return {
    synopsis: typeof parsed.synopsis === "string" ? parsed.synopsis : "",
    objectives,
    watchout: typeof parsed.watchout === "string" && parsed.watchout.trim() ? parsed.watchout : null,
  };
}

// The full prep that rides in the stub's thread — same shape as the
// UI's meeting-specific "🔬 Pre-Call Plan" Deal Chat prompt, so the
// Slack version and the in-app version give the same quality of prep.
const DEEP_PRECALL_PROMPT = `You are prepping a founder-seller for a SPECIFIC upcoming sales meeting. Using the full deal history, the founder's sales narrative, and their discovery framework, give a prep tuned to this meeting and these attendees:

1. **Where the deal stands** going into this meeting, and what this specific meeting needs to accomplish given the stage and what's happened since the last touch.
2. **For EACH attendee**: what we know about them from the deal history, their likely state of mind walking in, and what they'll care about in this meeting. Flag anyone we've never engaged before and how to read them.
3. **The two or three highest-leverage outcomes** to drive for.
4. **The specific questions to ask** — tuned to these attendees and this meeting type, working in open discovery gaps where they fit naturally.
5. **The questions or objections to expect FROM these attendees**, given their roles and everything they've said before.
6. **The smartest next-step ask** to land at the end.

Be specific to this meeting — use what's actually in the deal history, and call out anything important that's missing so the founder can fill it in before the call.

Formatting: this is read in Slack on the way to the call. Use a short "## " header per section and tight bullets under each. No preamble, no closing pleasantries, no tables. Keep it under ~700 words.`;

async function generateDeepPreCallPlan(opts: {
  meeting: PreCallMeetingInfo;
  sellerContext: string;
  discoveryFramework: string;
  evidence: string;
}): Promise<string> {
  const when = formatWhen(opts.meeting.startsAt);
  const sections = [
    DEEP_PRECALL_PROMPT,
    `## The Meeting\n**${opts.meeting.title}** — ${when}\nAttendees: ${opts.meeting.attendees.join(", ") || "(unknown)"}\n\nInvite notes:\n${opts.meeting.description.substring(0, 4000) || "(none)"}`,
    opts.sellerContext,
    opts.discoveryFramework,
    `## Deal History\n${opts.evidence.slice(-100_000)}`,
  ].filter(Boolean);
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    max_completion_tokens: 2500,
    messages: [{ role: "user", content: sections.join("\n\n---\n\n") }],
  });
  const text = completion.choices[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Deep pre-call plan came back empty");
  return text;
}

/**
 * Split Slack mrkdwn into section-block-sized chunks (3000-char block
 * limit), breaking on paragraph boundaries so formatting survives.
 */
function chunkForSlack(text: string, max = 2900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split(/\n\n+/)) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (para.length <= max) {
        current = para;
      } else {
        for (let i = 0; i < para.length; i += max) chunks.push(para.slice(i, i + max));
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Watch for meetings on in-play deals entering the lead window
 * (PRECALL_LEAD_HOURS before start) and post the pre-call plan stub.
 * Rides the 5-min cron. The (dealId, "precall_plan", meetingEntryId)
 * unique row is the at-most-once guard — a missed tick just posts a
 * little later (T-3h55 instead of T-4h), never twice and never after
 * the meeting.
 */
export async function sweepPreCallPlanStubs(maxPosts = 3): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + PRECALL_LEAD_HOURS * 60 * 60 * 1000);
  // Generous take: candidates that can never post (owner has no Slack
  // target) stay in the window for hours — a tight cap would let them
  // crowd out later meetings that CAN post. The real spend limiter is
  // maxPosts; the rest of the loop is cheap DB checks.
  const candidates = await prisma.dealTimelineEntry.findMany({
    where: {
      type: "meeting",
      entryDate: { gt: now, lte: windowEnd },
      deal: { status: { in: IN_PLAY_STATUSES } },
    },
    orderBy: { entryDate: "asc" },
    take: 50,
    include: {
      deal: {
        select: {
          id: true, userId: true, name: true, companyName: true,
          participants: { select: { name: true, title: true, email: true } },
        },
      },
    },
  });

  // Batch the "already posted?" lookup — entry ids are globally
  // unique cuids, so sourceRef alone is a safe key here.
  const postedRows = candidates.length
    ? await prisma.dealSlackPost.findMany({
        where: { kind: "precall_plan", sourceRef: { in: candidates.map((c) => c.id) } },
        select: { sourceRef: true },
      })
    : [];
  const alreadyPosted = new Set(postedRows.map((r) => r.sourceRef));
  const eligible = candidates.filter((c) => !alreadyPosted.has(c.id));
  // One line per tick, always — this is the sweep's heartbeat. If a
  // meeting isn't firing, this line says whether the query even sees
  // it (in window / already posted / eligible).
  console.log(
    `[timed-stubs] precall sweep: ${candidates.length} in ${PRECALL_LEAD_HOURS}h window, ${alreadyPosted.size} already posted, ${eligible.length} eligible`
  );
  if (eligible.length === 0) return 0;

  let posted = 0;
  for (const entry of eligible) {
    if (posted >= maxPosts) break;
    try {
      // Resolve the Slack target BEFORE paying for the brief.
      const target = await resolveSlackTarget(entry.deal.userId);
      if (!target) {
        console.log(
          `[timed-stubs] precall skip (no slack target): deal ${entry.dealId} user ${entry.deal.userId} "${entry.title}"`
        );
        continue;
      }

      // Attendee readout: prefer enriched participant names/titles,
      // fall back to the raw attendee emails on the entry metadata.
      let attendeeEmails: string[] = [];
      try {
        const m = JSON.parse(entry.metadata || "{}") as { attendeeEmails?: string[] };
        if (Array.isArray(m.attendeeEmails)) attendeeEmails = m.attendeeEmails;
      } catch { /* fine */ }
      const byEmail = new Map(
        entry.deal.participants
          .filter((p) => p.email)
          .map((p) => [p.email!.toLowerCase(), p])
      );
      const attendees = attendeeEmails.map((e) => {
        const p = byEmail.get(e.toLowerCase());
        return p ? (p.title ? `${p.name} (${p.title})` : p.name) : e;
      });
      const attendeeLine = attendees.slice(0, 6).join(", ") || "(attendees unknown)";

      // Assemble deal context ONCE — the stub brief and the deep
      // threaded plan both feed from it.
      const meeting: PreCallMeetingInfo = {
        title: entry.title || "Upcoming call",
        startsAt: new Date(entry.entryDate),
        description: entry.content || "",
        attendees,
      };
      const [seller, framework, assembled] = await Promise.all([
        loadSellerContext(entry.deal.userId),
        loadDiscoveryFramework(entry.deal.userId),
        assembleDealEvidence(entry.deal.userId, entry.dealId),
      ]);
      const evidence = assembled?.evidence || "(no evidence yet — first call)";

      const brief = await generatePreCallBrief({
        meeting,
        valueProp: seller.valueProp100w,
        evidence,
      });
      // The full six-section prep that rides in the stub's thread.
      // Generated BEFORE the stub posts so a generation failure never
      // leaves a recorded stub with a permanently missing thread.
      let deepPlan: string | null = null;
      try {
        deepPlan = await generateDeepPreCallPlan({
          meeting,
          sellerContext: formatSellerContext(seller),
          discoveryFramework: formatDiscoveryFramework(framework),
          evidence,
        });
      } catch (err) {
        console.error(`[timed-stubs] deep pre-call plan failed for entry ${entry.id}:`, err);
      }

      const appUrl = APP_URL();
      const company = entry.deal.companyName || entry.deal.name;
      const practiceUrl = `${appUrl}/practice?deal=${entry.dealId}&meeting=${entry.id}&label=${encodeURIComponent(entry.title || "Upcoming call")}`;
      const result = await target.client.chat.postMessage({
        channel: target.channelId,
        mrkdwn: true,
        text: `Pre-call plan: ${company} — ${entry.title || "upcoming call"}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `📋 New Pre-Call Plan: ${company}` },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `🗓 *${entry.title || "Upcoming call"}* — ${formatWhen(new Date(entry.entryDate))}\n` +
                `👥 ${attendeeLine}` +
                (brief.synopsis ? `\n\n_${brief.synopsis}_` : ""),
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*Top objectives:*\n${brief.objectives.map((o) => `• ${o}`).join("\n")}` +
                (brief.watchout ? `\n\n⚠️ ${brief.watchout}` : ""),
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `<${appUrl}/deals/${entry.dealId}|Open deal →>  ·  <${practiceUrl}|🥊 Practice this call>` +
                (deepPlan ? `  ·  🧵 Full prep in the thread` : ""),
            },
          },
        ],
      });
      await recordDealSlackPost({
        userId: entry.deal.userId,
        dealId: entry.dealId,
        kind: "precall_plan",
        sourceRef: entry.id,
        channelId: target.channelId,
        ts: result.ts || "",
      });

      // The deep plan rides as a reply under the stub — its own
      // thread, which Phase 4 will route straight back to this deal.
      if (deepPlan && result.ts) {
        try {
          const chunks = chunkForSlack(markdownToSlack(deepPlan));
          await target.client.chat.postMessage({
            channel: target.channelId,
            thread_ts: result.ts,
            mrkdwn: true,
            text: `Full pre-call plan: ${company} — ${entry.title || "upcoming call"}`,
            blocks: chunks.map((c) => ({
              type: "section" as const,
              text: { type: "mrkdwn" as const, text: c },
            })),
          });
        } catch (err) {
          console.error(`[timed-stubs] deep plan reply failed for entry ${entry.id}:`, err);
        }
      }
      posted++;
      console.log(
        `[timed-stubs] pre-call plan posted for deal ${entry.dealId} (${entry.title})${deepPlan ? " + threaded deep plan" : " (deep plan failed)"}`
      );
    } catch (err) {
      console.error(`[timed-stubs] pre-call stub failed for entry ${entry.id}:`, err);
    }
  }
  return posted;
}

// ── "🧠 Updated Deal Analysis" (post-recording cascade) ──────────────

const HEALTH_EMOJI: Record<string, string> = {
  poor: "🔴",
  fair: "🟡",
  good: "🟢",
  excellent: "🌟",
};

/** First real paragraph of the analysis markdown, clamped — the
 *  2-line synopsis for the stub. */
function synopsisFromAnalysis(analysis: string): string {
  const lines = analysis.split("\n");
  const para: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      if (para.length > 0) break;
      continue;
    }
    para.push(line.replace(/^[-*]\s*/, ""));
    if (para.join(" ").length > 240) break;
  }
  const text = para.join(" ");
  return text.length > 300 ? text.slice(0, 300).trimEnd() + "…" : text;
}

/**
 * "🧠 Updated Deal Analysis" stub — posted by the recorder cron's
 * analysis cascade after runDealAnalysis folds a new recording into
 * the deal. Health pill + synopsis + what changed.
 */
export async function postAnalysisUpdateStub(opts: {
  userId: string;
  dealId: string;
  companyName: string;
  healthBefore: string | null;
  healthAfter: string | null;
  analysis: string;
}): Promise<void> {
  const target = await resolveSlackTarget(opts.userId);
  if (!target) return;
  const appUrl = APP_URL();

  const after = opts.healthAfter?.toLowerCase() || null;
  const before = opts.healthBefore?.toLowerCase() || null;
  let healthLine = "";
  if (after) {
    const pill = `${HEALTH_EMOJI[after] || "⚪"} *${after}*`;
    healthLine =
      before && before !== after
        ? `Health: ${HEALTH_EMOJI[before] || "⚪"} ${before} → ${pill}`
        : `Health: ${pill}`;
  }
  const synopsis = synopsisFromAnalysis(opts.analysis);

  try {
    const posted = await target.client.chat.postMessage({
      channel: target.channelId,
      mrkdwn: true,
      text: `Updated deal analysis: ${opts.companyName}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🧠 Updated Deal Analysis: ${opts.companyName}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `New call evidence folded in.` +
              (healthLine ? ` ${healthLine}` : "") +
              (synopsis ? `\n\n> ${synopsis.replace(/\n/g, "\n> ")}` : ""),
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `<${appUrl}/deals/${opts.dealId}|Open deal →>` },
        },
      ],
    });
    await recordDealSlackPost({
      userId: opts.userId,
      dealId: opts.dealId,
      kind: "analysis_update",
      channelId: target.channelId,
      ts: posted.ts || "",
    });
  } catch (err) {
    console.error("[timed-stubs] analysis stub post failed:", err);
  }
}

/**
 * Small "call attached" note for the cooldown case: a recording
 * landed but the analysis cascade skipped re-analysis (the deal was
 * analyzed within the last 12h). The founder still learns the call
 * arrived; no token spend.
 */
export async function postCallAttachedStub(opts: {
  userId: string;
  dealId: string;
  dealName: string;
  companyName?: string | null;
}): Promise<void> {
  const target = await resolveSlackTarget(opts.userId);
  if (!target) return;
  const appUrl = APP_URL();
  try {
    const posted = await target.client.chat.postMessage({
      channel: target.channelId,
      mrkdwn: true,
      text: `New call attached to ${opts.dealName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `🗓 New call recording attached to *${opts.dealName}* — analysis is still fresh from earlier today, so I left it as-is. ` +
              `<${appUrl}/deals/${opts.dealId}|Open deal →>`,
          },
        },
      ],
    });
    await recordDealSlackPost({
      userId: opts.userId,
      dealId: opts.dealId,
      kind: "call_attached",
      channelId: target.channelId,
      ts: posted.ts || "",
    });
  } catch (err) {
    console.error("[timed-stubs] call-attached stub post failed:", err);
  }
}

// ── "🕵 No recording" nudge (7 days) ─────────────────────────────────

/**
 * A likely deal whose meeting happened 7+ days ago with no recording
 * (or any call content) landing since gets ONE nudge — still live?
 * Human-touch isn't required here (it's a question, not an action);
 * the (dealId, "no_recording_nudge", "once") row caps it at one per
 * deal, ever. Deals older than 21 days are the expiry sweep's
 * problem, not ours — the 14-day lookback floor keeps the two from
 * overlapping.
 */
export async function sweepNoRecordingNudges(maxPosts = 2): Promise<number> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const deals = await prisma.deal.findMany({
    where: {
      status: "likely",
      entries: {
        some: {
          type: "meeting",
          entryDate: { lt: sevenDaysAgo, gte: fourteenDaysAgo },
        },
        none: { type: { in: ["call_summary", "call_transcript"] } },
      },
    },
    take: 10,
    select: { id: true, userId: true, name: true, companyName: true },
  });
  if (deals.length === 0) return 0;

  let posted = 0;
  for (const deal of deals) {
    if (posted >= maxPosts) break;
    try {
      const already = await prisma.dealSlackPost.findUnique({
        where: {
          dealId_kind_sourceRef: {
            dealId: deal.id,
            kind: "no_recording_nudge",
            sourceRef: "once",
          },
        },
        select: { id: true },
      });
      if (already) continue;
      const target = await resolveSlackTarget(deal.userId);
      if (!target) continue;
      const appUrl = APP_URL();
      const company = deal.companyName || deal.name;
      const result = await target.client.chat.postMessage({
        channel: target.channelId,
        mrkdwn: true,
        text: `No recording yet for ${company}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `🕵 *${company}* — the call was over a week ago but no recording ever landed. ` +
                `Still live? <${appUrl}/deals/${deal.id}|Open the deal> to paste notes, or dismiss it.`,
            },
          },
          {
            type: "actions",
            block_id: `likely_deal_actions:${deal.id}`,
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✕ Not a deal" },
                value: deal.id,
                action_id: "dismiss_likely_deal",
              },
            ],
          },
        ],
      });
      await recordDealSlackPost({
        userId: deal.userId,
        dealId: deal.id,
        kind: "no_recording_nudge",
        sourceRef: "once",
        channelId: target.channelId,
        ts: result.ts || "",
      });
      posted++;
      console.log(`[timed-stubs] no-recording nudge posted for deal ${deal.id}`);
    } catch (err) {
      console.error(`[timed-stubs] nudge failed for deal ${deal.id}:`, err);
    }
  }
  return posted;
}
