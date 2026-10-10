import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { ACTIVITY_ENTRY_TYPES } from "@/lib/deals/constants";
import { runDealAnalysis } from "@/lib/deals/analyze";
import type { ToolContext, ToolEntry } from "@/lib/agents/shared/types";

// Re-export so existing imports of these names from this module keep
// working — types are now centralized in shared/types.
export type { ToolContext, ToolEntry };

/**
 * Tool registry for the per-deal Mikey agent (phase 1). Pipeline tools
 * are phase 2 — see docs/deal-agent-plan.md. Shared handler types
 * live in src/lib/agents/shared/types.ts so the GTM agent can compose
 * tools across modules.
 */

// ── Helpers ─────────────────────────────────────────────────────────

async function loadDealForUser(userId: string, dealId: string) {
  return prisma.deal.findFirst({
    where: { id: dealId, userId },
  });
}

function diffDays(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function summarizeAnalysisSection(markdown: string | null, heading: string): string | null {
  if (!markdown) return null;
  // Pull a single ## section out of the analyzer's markdown blob.
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headerMatch) {
      if (inSection) break;
      if (headerMatch[1].toLowerCase().trim() === heading.toLowerCase().trim()) {
        inSection = true;
        continue;
      }
    } else if (inSection) {
      out.push(line);
    }
  }
  const text = out.join("\n").trim();
  return text || null;
}

// ── Tools ───────────────────────────────────────────────────────────

const findDeal: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "findDeal",
      description:
        "Resolve a loose reference to a deal (company name, deal name, partial nickname) into one or more candidate dealIds. ALWAYS call this first when the user mentions a deal by name — every other deal tool needs a dealId. Returns up to 5 candidates sorted by confidence. If only one candidate has high confidence, use it directly; otherwise present the candidates to the user and ask which one they meant.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The user's reference to the deal — company name, deal name, partial nickname, or domain (e.g. 'MongoDB', 'the Acme pilot', 'sourcebot.dev').",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async ({ query }: { query: string }, { userId }) => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return { candidates: [], note: "Empty query." };
    // Pull a reasonable cap of recent / open deals once, then score in
    // memory. At founder scale this is at most a few hundred rows.
    const deals = await prisma.deal.findMany({
      where: { userId, status: { notIn: ["dismissed"] } },
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: { _count: { select: { entries: true } } },
    });
    const scored = deals.map((d) => {
      const name = d.name.toLowerCase();
      const co = d.companyName.toLowerCase();
      const url = (d.companyUrl || "").toLowerCase();
      let score = 0;
      if (name === q || co === q) score += 100;
      else if (name.startsWith(q) || co.startsWith(q)) score += 70;
      else if (name.includes(q) || co.includes(q)) score += 50;
      else if (url.includes(q)) score += 30;
      // Token overlap — handles "the mongodb deal" matching "MongoDB".
      const tokens = q.split(/\s+/).filter((t) => t.length > 2);
      let tokenHits = 0;
      for (const t of tokens) {
        if (name.includes(t) || co.includes(t)) tokenHits++;
      }
      score += tokenHits * 10;
      return { d, score };
    });
    const top = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ d, score }) => ({
        dealId: d.id,
        name: d.name,
        companyName: d.companyName,
        stage: d.stage,
        status: d.status,
        lastActivityHint: d.updatedAt.toISOString(),
        entryCount: d._count.entries,
        confidence: score >= 100 ? "high" : score >= 50 ? "medium" : "low",
      }));
    return { candidates: top, total: top.length };
  },
};

const getDealCore: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getDealCore",
      description:
        "Get the structured facts about a deal in one shot — stage, status, deal value, projected close date, Mikey Health, days open, days in current stage, last meaningful activity date (and what type of entry it was), the next upcoming meeting (date + title), count of timeline entries, count of participants. Use this for any 'what's the status with X' / 'where are we on X' question — it's the one tool that covers the full deal snapshot. Do NOT use for participant lists, timeline content, or analysis prose — call the dedicated tools for those.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string", description: "The deal's id (from findDeal)." },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async ({ dealId }: { dealId: string }, { userId }) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const now = new Date();
    // Parallelize the timeline lookups — they're independent and
    // each is a single-row query.
    const [lastStageChange, entryCount, participantCount, lastActivity, nextMeeting] = await Promise.all([
      prisma.dealTimelineEntry.findFirst({
        where: { dealId, type: "stage_change" },
        orderBy: { entryDate: "desc" },
        select: { entryDate: true },
      }),
      prisma.dealTimelineEntry.count({ where: { dealId } }),
      prisma.dealParticipant.count({ where: { dealId } }),
      // Most recent past entry (excludes chat breadcrumbs + future
      // calendar meetings). Mirrors the lastActivityAt the list
      // endpoint surfaces on each deal card.
      prisma.dealTimelineEntry.findFirst({
        where: {
          dealId,
          entryDate: { lte: now },
          type: { in: ACTIVITY_ENTRY_TYPES },
        },
        orderBy: { entryDate: "desc" },
        select: { entryDate: true, type: true, title: true },
      }),
      // Earliest upcoming meeting (type=meeting, entryDate in the
      // future). Mirrors nextMeetingAt on the list cards.
      prisma.dealTimelineEntry.findFirst({
        where: {
          dealId,
          type: "meeting",
          entryDate: { gt: now },
        },
        orderBy: { entryDate: "asc" },
        select: { entryDate: true, title: true },
      }),
    ]);
    const stageEnteredAt = lastStageChange?.entryDate || deal.createdAt;
    return {
      dealId: deal.id,
      name: deal.name,
      companyName: deal.companyName,
      companyUrl: deal.companyUrl,
      stage: deal.stage,
      status: deal.status,
      dealValue: deal.dealValue,
      projectedCloseDate: deal.projectedCloseDate?.toISOString() || null,
      closeDate: deal.closeDate?.toISOString() || null,
      mikeyHealth: deal.mikeyHealth,
      daysOpen: diffDays(now, deal.createdAt),
      daysInCurrentStage: diffDays(now, stageEnteredAt),
      lastAnalyzedAt: deal.lastAnalyzedAt?.toISOString() || null,
      entryCount,
      participantCount,
      lastActivity: lastActivity
        ? {
            date: lastActivity.entryDate.toISOString(),
            daysAgo: diffDays(now, lastActivity.entryDate),
            type: lastActivity.type,
            title: lastActivity.title,
          }
        : null,
      nextUpcomingMeeting: nextMeeting
        ? {
            date: nextMeeting.entryDate.toISOString(),
            daysFromNow: diffDays(nextMeeting.entryDate, now),
            title: nextMeeting.title,
          }
        : null,
      createdAt: deal.createdAt.toISOString(),
    };
  },
};

const getRecentActivity: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getRecentActivity",
      description:
        "Get a slice of the deal's timeline (most recent first). Use for 'what happened recently', 'what was the last touch', or to find a specific entry to feed into getCallDetail or draftFollowUpEmail. Returns id + type + title + date + preview (first 400 chars) — call getCallDetail to read the full body of a specific entry.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          days: {
            type: "number",
            description: "Look back N days. Default 30. Use 90 for a wide sweep.",
          },
          limit: {
            type: "number",
            description: "Max entries to return. Default 10, max 25.",
          },
          types: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific entry types (e.g. ['call_summary','call_transcript']). Omit for all.",
          },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async (
    { dealId, days, limit, types }: { dealId: string; days?: number; limit?: number; types?: string[] },
    { userId }
  ) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const since = new Date(Date.now() - (days ?? 30) * 86_400_000);
    const cap = Math.min(Math.max(limit ?? 10, 1), 25);
    const where: Record<string, unknown> = {
      dealId,
      entryDate: { gte: since },
      type: { not: "chat" },
    };
    if (types && types.length > 0) where.type = { in: types };
    const entries = await prisma.dealTimelineEntry.findMany({
      where,
      orderBy: { entryDate: "desc" },
      take: cap,
      select: {
        id: true,
        type: true,
        title: true,
        entryDate: true,
        content: true,
      },
    });
    return {
      entries: entries.map((e) => ({
        entryId: e.id,
        type: e.type,
        title: e.title,
        date: e.entryDate.toISOString(),
        preview: (e.content || "").substring(0, 400) + ((e.content?.length || 0) > 400 ? "…" : ""),
      })),
      windowDays: days ?? 30,
    };
  },
};

const getCallDetail: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getCallDetail",
      description:
        "Read the FULL transcript / summary content of a single timeline entry (typically a call_summary or call_transcript). Use when synthesizing follow-up emails, prepping for a meeting that references a prior call, or answering a question that requires reading what was actually said. The entryId comes from getRecentActivity.",
      parameters: {
        type: "object",
        properties: {
          entryId: { type: "string" },
        },
        required: ["entryId"],
      },
    },
  },
  handler: async ({ entryId }: { entryId: string }, { userId }) => {
    const entry = await prisma.dealTimelineEntry.findFirst({
      where: { id: entryId, deal: { userId } },
      select: { id: true, type: true, title: true, entryDate: true, content: true, sourceUrl: true, metadata: true },
    });
    if (!entry) return { error: "Entry not found or not accessible." };
    let attendees: string[] = [];
    if (entry.metadata) {
      try {
        const m = JSON.parse(entry.metadata) as { attendeeEmails?: unknown };
        if (Array.isArray(m.attendeeEmails)) {
          attendees = m.attendeeEmails.filter((e): e is string => typeof e === "string");
        }
      } catch { /* ignore */ }
    }
    return {
      entryId: entry.id,
      type: entry.type,
      title: entry.title,
      date: entry.entryDate.toISOString(),
      sourceUrl: entry.sourceUrl,
      attendees,
      content: entry.content,
    };
  },
};

const getParticipants: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getParticipants",
      description:
        "Get the contacts on a deal — name, title, company, email, role (decision_maker / champion / influencer / blocker / end_user / unknown), and LinkedIn URL when known. Use for any 'who's on the deal', 'who's the champion', or stakeholder-mapping question.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async ({ dealId }: { dealId: string }, { userId }) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const participants = await prisma.dealParticipant.findMany({
      where: { dealId },
      select: {
        id: true,
        name: true,
        title: true,
        company: true,
        email: true,
        role: true,
        linkedinUrl: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return { participants };
  },
};

const getHealthAndRisks: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getHealthAndRisks",
      description:
        "Get the Mikey Health rating and the latest analyzer's 'Risks & Gaps', 'Strengths', and 'Discovery Gaps' sections for a deal. Use when the user asks how the deal is doing, what's wrong, what's working, or what's still unknown / undiscovered. Returns null sections if the deal has never been analyzed.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async ({ dealId }: { dealId: string }, { userId }) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    return {
      mikeyHealth: deal.mikeyHealth,
      lastAnalyzedAt: deal.lastAnalyzedAt?.toISOString() || null,
      strengths: summarizeAnalysisSection(deal.lastAnalysis, "Strengths"),
      risksAndGaps: summarizeAnalysisSection(deal.lastAnalysis, "Risks & Gaps"),
      discoveryGaps: summarizeAnalysisSection(deal.lastAnalysis, "Discovery Gaps"),
      stakeholderMap: summarizeAnalysisSection(deal.lastAnalysis, "Stakeholder Map"),
    };
  },
};

const getUpcomingMeetings: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getUpcomingMeetings",
      description:
        "Get future calendar events on a deal (next 90 days). Use for 'when's the next call', 'what's on the calendar', 'is there a meeting scheduled'. Returns an empty list if nothing's scheduled — a live deal with no upcoming meeting is itself a signal.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async ({ dealId }: { dealId: string }, { userId }) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 86_400_000);
    const events = await prisma.dealTimelineEntry.findMany({
      where: {
        dealId,
        type: "meeting",
        entryDate: { gte: now, lte: horizon },
      },
      orderBy: { entryDate: "asc" },
      select: { id: true, title: true, entryDate: true, content: true, sourceUrl: true },
    });
    return {
      events: events.map((e) => ({
        entryId: e.id,
        title: e.title,
        date: e.entryDate.toISOString(),
        sourceUrl: e.sourceUrl,
        descriptionPreview: (e.content || "").substring(0, 300),
      })),
    };
  },
};

const getBusinessCaseArtifacts: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getBusinessCaseArtifacts",
      description:
        "List the generated Business Case artifacts on a deal — Discovery Summaries, ROI Models, Business Cases — with their full content. Use when the user asks about the discovery summary, business case, ROI model, or 'what have we written up' for a deal. Each artifact includes a link (/business-cases?instance=<id>) — include it when referencing one. Returns an empty list if none have been generated (suggest the 'Discovery Summary' button on the deal page, or the Business Cases applet).",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          type: {
            type: "string",
            enum: ["discovery_summary", "roi_model", "business_case"],
            description: "Optional filter to one artifact type.",
          },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async (
    { dealId, type }: { dealId: string; type?: string },
    { userId }
  ) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const artifacts = await prisma.businessCaseInstance.findMany({
      where: { dealId, ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        sourceContext: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      artifacts: artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        content: a.content,
        basedOn: a.sourceContext,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        link: `/business-cases?tab=${a.type}&instance=${a.id}`,
      })),
    };
  },
};

const summarizeCall: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "summarizeCall",
      description:
        "Pick one specific recorded call on a deal and return its FULL content so you can write a summary. Three ways to point at the call (in priority order): (1) pass entryId if you already know it from another tool; (2) pass startDate + endDate (ISO yyyy-mm-dd) to scope to a date range — e.g. 'first week of June 2026' → 2026-06-01 through 2026-06-07 — and the latest call in that range is returned; (3) omit all of those and the MOST RECENT call on the deal is returned. After receiving the content, write a tight summary: 4-6 bullets covering what was discussed, decisions or commitments made, open questions, and any agreed next steps. Use specifics from the call (names, numbers, dates) — no generic summary-speak.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          entryId: {
            type: "string",
            description: "Optional. The specific call entry to summarize, if you already have its id.",
          },
          startDate: {
            type: "string",
            description: "Optional. ISO date (yyyy-mm-dd) — inclusive lower bound of the search window.",
          },
          endDate: {
            type: "string",
            description: "Optional. ISO date (yyyy-mm-dd) — inclusive upper bound of the search window.",
          },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async (
    { dealId, entryId, startDate, endDate }: { dealId: string; entryId?: string; startDate?: string; endDate?: string },
    { userId }
  ) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };

    // Priority 1: a specific entryId was passed in.
    if (entryId) {
      const entry = await prisma.dealTimelineEntry.findFirst({
        where: { id: entryId, dealId, type: { in: ["call_summary", "call_transcript"] } },
        select: { id: true, type: true, title: true, entryDate: true, content: true },
      });
      if (!entry) return { error: "Entry not found, not on this deal, or not a recorded call." };
      return {
        match: "by entryId",
        call: {
          entryId: entry.id,
          type: entry.type,
          title: entry.title,
          date: entry.entryDate.toISOString(),
          content: entry.content,
        },
        directive:
          "Write the summary now in 4-6 bullets — what was discussed, commitments, open questions, next steps. Specifics only; no preamble.",
      };
    }

    // Priority 2: date range. If only one bound is provided, treat
    // the other as open. Returns the LATEST call within the range so
    // "this morning's call" or "the early-June call" both resolve to
    // the right one when only one matches.
    const where: Record<string, unknown> = {
      dealId,
      type: { in: ["call_summary", "call_transcript"] },
    };
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
      where.entryDate = dateFilter;
    }

    // Pull a small candidate set so we can both return the latest AND
    // hint to the agent when the range was ambiguous (multiple calls
    // matched, agent may want to ask the user to narrow it down).
    const candidates = await prisma.dealTimelineEntry.findMany({
      where,
      orderBy: { entryDate: "desc" },
      take: 5,
      select: { id: true, type: true, title: true, entryDate: true, content: true },
    });

    if (candidates.length === 0) {
      return {
        error:
          startDate || endDate
            ? "No recorded calls on this deal in that date range."
            : "No recorded calls on this deal yet.",
      };
    }

    const top = candidates[0];
    const others = candidates.slice(1).map((c) => ({
      entryId: c.id,
      type: c.type,
      title: c.title,
      date: c.entryDate.toISOString(),
    }));

    return {
      match: startDate || endDate ? "by date range (latest in range)" : "most recent",
      call: {
        entryId: top.id,
        type: top.type,
        title: top.title,
        date: top.entryDate.toISOString(),
        content: top.content,
      },
      otherCandidatesInRange: others,
      directive:
        "Write the summary now in 4-6 bullets — what was discussed, commitments, open questions, next steps. Use the specifics of the call (names, numbers, dates), not generic summary-speak. If otherCandidatesInRange has entries, briefly note at the end which other calls in the range you could summarize next.",
    };
  },
};

// prepForMeeting and nextBestAction are NOT separate tools. The agent
// composes those answers itself by calling the structured read tools
// (getDealCore + getRecentActivity + getParticipants + getHealthAndRisks
// + getUpcomingMeetings) and synthesizing in the format the system
// prompt prescribes. That keeps the answers grounded in real data
// instead of paraphrased prose and avoids a layer of LLM round-tripping
// inside the tool layer.

const draftFollowUpEmail: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "draftFollowUpEmail",
      description:
        "Gather the context needed to draft a follow-up email tied to a specific call on the deal. Returns the call's full content + the deal's participants + recent context + the sales narrative voice — YOU then write the email in your reply using that context, following the requested intent. Default intent is 'next-steps'. NEVER pretend you sent it; the user reviews and sends themselves.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          fromCallEntryId: {
            type: "string",
            description: "Optional. The entryId of the call to anchor the follow-up on. If omitted, the most recent call_summary on the deal is used.",
          },
          intent: {
            type: "string",
            enum: ["next-steps", "re-engage", "pricing-followup", "thanks-and-recap"],
            description: "What the email is for. Default 'next-steps'.",
          },
        },
        required: ["dealId"],
      },
    },
  },
  handler: async (
    { dealId, fromCallEntryId, intent }: { dealId: string; fromCallEntryId?: string; intent?: string },
    { userId }
  ) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    let anchorEntry;
    if (fromCallEntryId) {
      anchorEntry = await prisma.dealTimelineEntry.findFirst({
        where: { id: fromCallEntryId, dealId },
        select: { id: true, type: true, title: true, entryDate: true, content: true, metadata: true },
      });
    }
    if (!anchorEntry) {
      anchorEntry = await prisma.dealTimelineEntry.findFirst({
        where: { dealId, type: { in: ["call_summary", "call_transcript"] } },
        orderBy: { entryDate: "desc" },
        select: { id: true, type: true, title: true, entryDate: true, content: true, metadata: true },
      });
    }
    if (!anchorEntry) {
      return {
        error: "No recorded calls on this deal yet — can't draft a follow-up without a call to anchor on.",
      };
    }
    const participants = await prisma.dealParticipant.findMany({
      where: { dealId },
      select: { name: true, title: true, email: true, role: true },
    });
    return {
      dealName: deal.name,
      companyName: deal.companyName,
      intent: intent || "next-steps",
      anchorCall: {
        entryId: anchorEntry.id,
        title: anchorEntry.title,
        date: anchorEntry.entryDate.toISOString(),
        content: anchorEntry.content,
      },
      participants,
      directive:
        "Write the email body now (no preamble, no 'here's the email'). Open with a Subject: line, then a blank line, then the body. Use the sender's voice from any prior emails on the deal if visible. Keep it under 200 words. Reference specifics from the anchor call. Close with a concrete proposed next step appropriate to the chosen intent.",
    };
  },
};

const addTimelineEntry: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "addTimelineEntry",
      description:
        "Append a note, email, slack message, or other entry to the deal's timeline. Use when the user says 'log that X' or 'add a note saying Y'. Returns the created entry's id + a preview so you can confirm to the user what was written. This is the ONLY mutating tool in phase 1.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string" },
          type: {
            type: "string",
            enum: ["note", "email", "slack_message", "sms_message", "linkedin", "twitter_dm"],
            description: "What kind of entry to log.",
          },
          content: {
            type: "string",
            description: "The body of the entry.",
          },
          title: {
            type: "string",
            description: "Optional short title. If omitted, the first line of content is used.",
          },
        },
        required: ["dealId", "type", "content"],
      },
    },
  },
  handler: async (
    {
      dealId,
      type,
      content,
      title,
    }: { dealId: string; type: string; content: string; title?: string },
    { userId }
  ) => {
    const deal = await loadDealForUser(userId, dealId);
    if (!deal) return { error: "Deal not found or not accessible." };
    const entry = await prisma.dealTimelineEntry.create({
      data: {
        dealId,
        type,
        title: title || content.split("\n")[0].substring(0, 80),
        content,
        entryDate: new Date(),
        metadata: JSON.stringify({ source: "deal-agent" }),
      },
      select: { id: true, type: true, title: true, entryDate: true },
    });
    // Best-effort re-analysis kickoff so the deal's downstream stats
    // freshen up without making the agent wait. Errors swallowed.
    runDealAnalysis(userId, dealId).catch((err) =>
      console.error(`[deal-agent] post-add reanalysis failed:`, err)
    );
    return {
      entryId: entry.id,
      type: entry.type,
      title: entry.title,
      date: entry.entryDate.toISOString(),
      confirmation: `Logged a ${type} entry on the deal.`,
    };
  },
};

// ── Pipeline tools — cross-deal aggregates ──────────────────────────
//
// These tools operate across the user's whole pipeline rather than
// any single deal. The deal Slack router only fires when a deal name
// matches the message, so pipeline questions ("what's at risk?",
// "what's likely to close?") naturally fall through to the GTM agent
// — which re-exports these handlers via DEAL_TOOLS.

// Settled statuses that should be excluded from "open pipeline" views.
const PIPELINE_OPEN_STATUS_FILTER = {
  notIn: ["closed_won", "closed_lost", "dismissed"],
};

// Healths considered "good enough to ride" — used by getDealsLikelyToClose.
const HEALTHY_HEALTHS = ["good", "excellent"];
// Late-pipeline stages — used by getDealsLikelyToClose.
const LATE_STAGES = ["negotiation", "closing", "proposal"];

// Build a summary row used by listPipeline + the risk/close tools.
// One round-trip per deal to grab the most-recent-past timeline entry
// for the daysSinceLastActivity signal.
async function summarizeDealRows(
  deals: Array<{
    id: string;
    name: string;
    companyName: string;
    stage: string;
    status: string;
    dealValue: number | null;
    projectedCloseDate: Date | null;
    mikeyHealth: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
) {
  const now = new Date();
  const lastActivities = await Promise.all(
    deals.map((d) =>
      prisma.dealTimelineEntry.findFirst({
        where: { dealId: d.id, entryDate: { lte: now }, type: { in: ACTIVITY_ENTRY_TYPES } },
        orderBy: { entryDate: "desc" },
        select: { entryDate: true, type: true, title: true },
      })
    )
  );
  return deals.map((d, idx) => {
    const la = lastActivities[idx];
    return {
      dealId: d.id,
      name: d.name,
      companyName: d.companyName,
      stage: d.stage,
      status: d.status,
      dealValue: d.dealValue,
      projectedCloseDate: d.projectedCloseDate?.toISOString() || null,
      daysToProjectedClose: d.projectedCloseDate
        ? Math.round((d.projectedCloseDate.getTime() - now.getTime()) / 86_400_000)
        : null,
      mikeyHealth: d.mikeyHealth,
      daysOpen: diffDays(now, d.createdAt),
      lastActivity: la
        ? {
            date: la.entryDate.toISOString(),
            daysAgo: diffDays(now, la.entryDate),
            type: la.type,
            title: la.title,
          }
        : null,
      daysSinceLastActivity: la ? diffDays(now, la.entryDate) : diffDays(now, d.createdAt),
    };
  });
}

const listPipeline: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "listPipeline",
      description:
        "List deals across the founder's pipeline with optional filters and sort. Default: open deals (excludes closed_won / closed_lost / dismissed), sorted by most recently updated, cap 25. Use for any 'show me deals where X' / 'what deals do I have' / 'list deals in X stage' question. Returns summary rows (name, company, stage, status, value, projected close, Mikey health, days since last activity) — call getDealCore for full per-deal detail.",
      parameters: {
        type: "object",
        properties: {
          stage: {
            type: "string",
            description: "Filter by exact stage slug (prospecting / discovery / demo / proposal / negotiation / closing / won / lost, or a custom stage slug).",
          },
          status: {
            type: "string",
            enum: ["active", "stalled", "potential", "closed_won", "closed_lost", "dismissed", "any_open"],
            description:
              "Filter by status. Default 'any_open' (all open statuses, excludes closed/dismissed). Pass an explicit value to override.",
          },
          mikeyHealth: {
            type: "string",
            enum: ["poor", "fair", "good", "excellent"],
            description: "Filter by Mikey health rating.",
          },
          minValue: { type: "number", description: "Minimum dealValue (whole dollars)." },
          maxValue: { type: "number", description: "Maximum dealValue (whole dollars)." },
          closingWithinDays: {
            type: "number",
            description: "Only deals with projectedCloseDate within the next N days from today.",
          },
          sortBy: {
            type: "string",
            enum: ["updatedAt", "createdAt", "projectedCloseDate", "dealValue", "mikeyHealth"],
            description: "Sort key. Default 'updatedAt' (most recent first). mikeyHealth sorts excellent→good→fair→poor.",
          },
          limit: { type: "number", description: "Max rows to return. Default 25, max 100." },
        },
      },
    },
  },
  handler: async (
    args: {
      stage?: string;
      status?: "active" | "stalled" | "potential" | "closed_won" | "closed_lost" | "dismissed" | "any_open";
      mikeyHealth?: string;
      minValue?: number;
      maxValue?: number;
      closingWithinDays?: number;
      sortBy?: "updatedAt" | "createdAt" | "projectedCloseDate" | "dealValue" | "mikeyHealth";
      limit?: number;
    },
    { userId }
  ) => {
    const cap = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const where: Record<string, unknown> = { userId };
    if (args.status && args.status !== "any_open") where.status = args.status;
    else where.status = PIPELINE_OPEN_STATUS_FILTER;
    if (args.stage) where.stage = args.stage;
    if (args.mikeyHealth) where.mikeyHealth = args.mikeyHealth;
    if (args.minValue != null || args.maxValue != null) {
      const valueFilter: Record<string, number> = {};
      if (args.minValue != null) valueFilter.gte = args.minValue;
      if (args.maxValue != null) valueFilter.lte = args.maxValue;
      where.dealValue = valueFilter;
    }
    if (args.closingWithinDays != null) {
      const now = new Date();
      const horizon = new Date(now.getTime() + args.closingWithinDays * 86_400_000);
      where.projectedCloseDate = { gte: now, lte: horizon };
    }
    const orderBy = (() => {
      switch (args.sortBy) {
        case "createdAt":
          return { createdAt: "desc" as const };
        case "projectedCloseDate":
          // null projectedCloseDate sorts last — Prisma default for asc.
          return { projectedCloseDate: "asc" as const };
        case "dealValue":
          return { dealValue: "desc" as const };
        case "mikeyHealth":
          // Lexical sort happens to put excellent>good>fair>poor in
          // the right order desc — but only because of the letters.
          // Re-sort in JS below for correctness.
          return { updatedAt: "desc" as const };
        case "updatedAt":
        default:
          return { updatedAt: "desc" as const };
      }
    })();
    const deals = await prisma.deal.findMany({
      where,
      orderBy,
      take: cap,
      select: {
        id: true,
        name: true,
        companyName: true,
        stage: true,
        status: true,
        dealValue: true,
        projectedCloseDate: true,
        mikeyHealth: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (args.sortBy === "mikeyHealth") {
      const rank: Record<string, number> = { excellent: 0, good: 1, fair: 2, poor: 3 };
      deals.sort((a, b) => {
        const ra = a.mikeyHealth ? rank[a.mikeyHealth] ?? 99 : 99;
        const rb = b.mikeyHealth ? rank[b.mikeyHealth] ?? 99 : 99;
        return ra - rb;
      });
    }
    const rows = await summarizeDealRows(deals);
    return { count: rows.length, deals: rows };
  },
};

const getPipelineSummary: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getPipelineSummary",
      description:
        "Aggregate view of the open pipeline: count + total deal value by stage, breakdown by Mikey health, breakdown by status, and a coarse forecast for deals projected to close in the next 30 / 60 / 90 days. Use for 'how big is my pipeline', 'show me the funnel', 'what's my forecast', 'pipeline by stage'.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const now = new Date();
    const horizons = {
      d30: new Date(now.getTime() + 30 * 86_400_000),
      d60: new Date(now.getTime() + 60 * 86_400_000),
      d90: new Date(now.getTime() + 90 * 86_400_000),
    };
    const deals = await prisma.deal.findMany({
      where: { userId, status: PIPELINE_OPEN_STATUS_FILTER },
      select: {
        stage: true,
        status: true,
        mikeyHealth: true,
        dealValue: true,
        projectedCloseDate: true,
      },
    });
    const byStage = new Map<string, { count: number; valueSum: number; valueKnown: number }>();
    const byHealth = new Map<string, number>();
    const byStatus = new Map<string, number>();
    let totalCount = 0;
    let totalValueSum = 0;
    let totalValueKnown = 0;
    const forecast = { next30: 0, next60: 0, next90: 0 };
    const forecastValue = { next30: 0, next60: 0, next90: 0 };
    for (const d of deals) {
      totalCount += 1;
      const s = byStage.get(d.stage) || { count: 0, valueSum: 0, valueKnown: 0 };
      s.count += 1;
      if (d.dealValue != null) {
        s.valueSum += d.dealValue;
        s.valueKnown += 1;
        totalValueSum += d.dealValue;
        totalValueKnown += 1;
      }
      byStage.set(d.stage, s);
      byHealth.set(d.mikeyHealth || "(unrated)", (byHealth.get(d.mikeyHealth || "(unrated)") || 0) + 1);
      byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
      if (d.projectedCloseDate && d.projectedCloseDate >= now) {
        if (d.projectedCloseDate <= horizons.d30) {
          forecast.next30 += 1;
          if (d.dealValue != null) forecastValue.next30 += d.dealValue;
        }
        if (d.projectedCloseDate <= horizons.d60) {
          forecast.next60 += 1;
          if (d.dealValue != null) forecastValue.next60 += d.dealValue;
        }
        if (d.projectedCloseDate <= horizons.d90) {
          forecast.next90 += 1;
          if (d.dealValue != null) forecastValue.next90 += d.dealValue;
        }
      }
    }
    return {
      totalOpenDeals: totalCount,
      totalKnownPipelineValue: totalValueSum,
      dealsWithValueSet: totalValueKnown,
      dealsWithoutValueSet: totalCount - totalValueKnown,
      byStage: Array.from(byStage.entries()).map(([stage, v]) => ({
        stage,
        count: v.count,
        knownValueSum: v.valueSum,
        dealsWithValueSet: v.valueKnown,
      })),
      byMikeyHealth: Object.fromEntries(byHealth),
      byStatus: Object.fromEntries(byStatus),
      projectedClosingForecast: {
        next30Days: { dealCount: forecast.next30, knownValueSum: forecastValue.next30 },
        next60Days: { dealCount: forecast.next60, knownValueSum: forecastValue.next60 },
        next90Days: { dealCount: forecast.next90, knownValueSum: forecastValue.next90 },
      },
    };
  },
};

const getDealsLikelyToClose: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getDealsLikelyToClose",
      description:
        "Deals most likely to close near-term. Heuristic: stage in {proposal, negotiation, closing} AND Mikey health in {good, excellent} AND (no projected close set, OR projected close within the horizon). Returns top N sorted by projected close date ascending (soonest first), with the signals that fired. Use for 'what's likely to close', 'what's hot', 'what's near the finish line'.",
      parameters: {
        type: "object",
        properties: {
          horizonDays: {
            type: "number",
            description: "Window for projected close. Default 60.",
          },
          limit: { type: "number", description: "Max rows. Default 10, max 30." },
        },
      },
    },
  },
  handler: async (
    { horizonDays, limit }: { horizonDays?: number; limit?: number },
    { userId }
  ) => {
    const cap = Math.min(Math.max(limit ?? 10, 1), 30);
    const window = Math.max(horizonDays ?? 60, 1);
    const now = new Date();
    const horizon = new Date(now.getTime() + window * 86_400_000);
    const deals = await prisma.deal.findMany({
      where: {
        userId,
        status: PIPELINE_OPEN_STATUS_FILTER,
        stage: { in: LATE_STAGES },
        mikeyHealth: { in: HEALTHY_HEALTHS },
        OR: [
          { projectedCloseDate: null },
          { projectedCloseDate: { gte: now, lte: horizon } },
        ],
      },
      orderBy: [{ projectedCloseDate: "asc" }, { updatedAt: "desc" }],
      take: cap,
      select: {
        id: true,
        name: true,
        companyName: true,
        stage: true,
        status: true,
        dealValue: true,
        projectedCloseDate: true,
        mikeyHealth: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const rows = await summarizeDealRows(deals);
    return {
      horizonDays: window,
      count: rows.length,
      // Restate the signals so the agent can echo them back without
      // having to reconstruct the heuristic in prose.
      signalsApplied: ["late-stage (proposal/negotiation/closing)", "Mikey health good or excellent", `projected close within ${window} days (or unset)`],
      deals: rows,
    };
  },
};

const getDealsNeedingHelp: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getDealsNeedingHelp",
      description:
        "Open deals that are flashing risk signals — Mikey health poor, status stalled, no logged activity in N days (default 14), or projected close date slipped past today. Returns the top N most-concerning deals, each with the LIST of signals that fired (so the agent can explain WHY each one needs help, not just that it does). Use for 'what's at risk', 'what needs attention', 'what's stalled', 'what's slipping'.",
      parameters: {
        type: "object",
        properties: {
          staleDays: {
            type: "number",
            description: "Treat 'no logged activity in N days' as a risk signal. Default 14.",
          },
          limit: { type: "number", description: "Max rows. Default 10, max 30." },
        },
      },
    },
  },
  handler: async (
    { staleDays, limit }: { staleDays?: number; limit?: number },
    { userId }
  ) => {
    const cap = Math.min(Math.max(limit ?? 10, 1), 30);
    const staleAfterDays = Math.max(staleDays ?? 14, 1);
    const now = new Date();

    // Pull the candidate set with any of: poor health, stalled status,
    // or projectedCloseDate slipped past. We score the stale-activity
    // signal in JS after the lastActivity lookup since the SQL would
    // require a left-join + correlated NOT EXISTS.
    const candidates = await prisma.deal.findMany({
      where: {
        userId,
        status: PIPELINE_OPEN_STATUS_FILTER,
        OR: [
          { mikeyHealth: "poor" },
          { status: "stalled" },
          { projectedCloseDate: { lt: now } },
          // Always include the rest of the pipeline so the stale-
          // activity check below can flag deals that wouldn't otherwise
          // appear. Bound to reasonable size; founder pipelines are
          // small. Filter cap is just for safety.
          {},
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        companyName: true,
        stage: true,
        status: true,
        dealValue: true,
        projectedCloseDate: true,
        mikeyHealth: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const rows = await summarizeDealRows(candidates);
    const flagged = rows
      .map((r) => {
        const signals: string[] = [];
        const original = candidates.find((c) => c.id === r.dealId)!;
        if (original.mikeyHealth === "poor") signals.push("Mikey health: poor");
        if (original.status === "stalled") signals.push("status: stalled");
        if (
          original.projectedCloseDate &&
          original.projectedCloseDate < now
        ) {
          signals.push(
            `projected close slipped past (${original.projectedCloseDate.toISOString().slice(0, 10)})`
          );
        }
        if (r.daysSinceLastActivity >= staleAfterDays) {
          const refDate = r.lastActivity?.date
            ? `last activity ${r.daysSinceLastActivity}d ago`
            : `no logged activity (deal ${r.daysOpen}d old)`;
          signals.push(`stale: ${refDate}`);
        }
        return { ...r, riskSignals: signals };
      })
      .filter((r) => r.riskSignals.length > 0);
    // Rank by signal count desc, then by daysSinceLastActivity desc.
    flagged.sort((a, b) => {
      if (b.riskSignals.length !== a.riskSignals.length) {
        return b.riskSignals.length - a.riskSignals.length;
      }
      return b.daysSinceLastActivity - a.daysSinceLastActivity;
    });
    return {
      staleDaysThreshold: staleAfterDays,
      count: flagged.length,
      deals: flagged.slice(0, cap),
    };
  },
};

const getUpcomingDealActivity: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getUpcomingDealActivity",
      description:
        "Future-dated activity (meetings primarily) across ALL deals in a date window. Default: next 14 days. Use for 'what meetings do I have this week', 'what's on my calendar deal-wise', 'what's coming up'. Groups events by deal so the agent can write 'You have X with Acme on Mon, Y with Globex on Wed'.",
      parameters: {
        type: "object",
        properties: {
          horizonDays: {
            type: "number",
            description: "How many days forward to look. Default 14, max 90.",
          },
          limit: { type: "number", description: "Max events to return. Default 30, max 100." },
        },
      },
    },
  },
  handler: async (
    { horizonDays, limit }: { horizonDays?: number; limit?: number },
    { userId }
  ) => {
    const window = Math.min(Math.max(horizonDays ?? 14, 1), 90);
    const cap = Math.min(Math.max(limit ?? 30, 1), 100);
    const now = new Date();
    const horizon = new Date(now.getTime() + window * 86_400_000);
    const events = await prisma.dealTimelineEntry.findMany({
      where: {
        deal: { userId, status: PIPELINE_OPEN_STATUS_FILTER },
        type: "meeting",
        entryDate: { gte: now, lte: horizon },
      },
      orderBy: { entryDate: "asc" },
      take: cap,
      select: {
        id: true,
        title: true,
        entryDate: true,
        sourceUrl: true,
        content: true,
        deal: {
          select: {
            id: true,
            name: true,
            companyName: true,
            stage: true,
            mikeyHealth: true,
          },
        },
      },
    });
    // Group by deal so the agent can write one line per deal.
    const byDeal = new Map<
      string,
      {
        dealId: string;
        dealName: string;
        companyName: string;
        stage: string;
        mikeyHealth: string | null;
        events: Array<{
          entryId: string;
          title: string;
          date: string;
          daysFromNow: number;
          sourceUrl: string | null;
          descriptionPreview: string;
        }>;
      }
    >();
    for (const e of events) {
      const group = byDeal.get(e.deal.id) || {
        dealId: e.deal.id,
        dealName: e.deal.name,
        companyName: e.deal.companyName,
        stage: e.deal.stage,
        mikeyHealth: e.deal.mikeyHealth,
        events: [],
      };
      group.events.push({
        entryId: e.id,
        title: e.title || "(untitled meeting)",
        date: e.entryDate.toISOString(),
        daysFromNow: diffDays(e.entryDate, now),
        sourceUrl: e.sourceUrl,
        descriptionPreview: (e.content || "").substring(0, 240),
      });
      byDeal.set(e.deal.id, group);
    }
    return {
      horizonDays: window,
      totalEvents: events.length,
      deals: Array.from(byDeal.values()),
    };
  },
};

// ── Registry ────────────────────────────────────────────────────────

export const DEAL_TOOLS: Record<string, ToolEntry> = {
  findDeal,
  getDealCore,
  getRecentActivity,
  getCallDetail,
  getParticipants,
  getHealthAndRisks,
  getUpcomingMeetings,
  getBusinessCaseArtifacts,
  summarizeCall,
  draftFollowUpEmail,
  addTimelineEntry,
  // Pipeline (cross-deal) tools — used by the GTM catch-all agent
  // when a question doesn't anchor on a single deal.
  listPipeline,
  getPipelineSummary,
  getDealsLikelyToClose,
  getDealsNeedingHelp,
  getUpcomingDealActivity,
};

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(DEAL_TOOLS).map((t) => t.definition);
}
