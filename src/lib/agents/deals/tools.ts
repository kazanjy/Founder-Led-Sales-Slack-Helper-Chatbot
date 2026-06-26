import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { runDealAnalysis } from "@/lib/deals/analyze";

/**
 * Tool registry for the per-deal Mikey agent (phase 1).
 *
 * Each entry pairs an OpenAI tool/function definition with a handler
 * that runs server-side. The handler ALWAYS receives the userId from
 * the trusted server context — never from the LLM — so a hallucinated
 * tool call can't read another user's deal data.
 *
 * Pipeline tools (listDeals, findDealsByPerson, dealsNeedingAttention,
 * etc.) are phase 2 and intentionally absent here. See
 * docs/deal-agent-plan.md.
 */

export interface ToolContext {
  userId: string;
}

export interface ToolEntry {
  definition: ChatCompletionTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}

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
        "Get the structured facts about a deal: stage, status, deal value, projected close date, Mikey Health, days open, days in current stage, count of timeline entries, count of participants. Use this for any question about deal METADATA. Do NOT use for participant lists, timeline content, or analysis prose — call the dedicated tools for those.",
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
    // Find the most recent stage_change entry to compute days-in-stage.
    const lastStageChange = await prisma.dealTimelineEntry.findFirst({
      where: { dealId, type: "stage_change" },
      orderBy: { entryDate: "desc" },
      select: { entryDate: true },
    });
    const stageEnteredAt = lastStageChange?.entryDate || deal.createdAt;
    const now = new Date();
    const [entryCount, participantCount] = await Promise.all([
      prisma.dealTimelineEntry.count({ where: { dealId } }),
      prisma.dealParticipant.count({ where: { dealId } }),
    ]);
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
        "Get the Mikey Health rating and the latest analyzer's 'Risks & Gaps' + 'Strengths' sections for a deal. Use when the user asks how the deal is doing, what's wrong, or what's working. Returns null sections if the deal has never been analyzed.",
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
            enum: ["note", "email", "slack_message", "sms_message", "linkedin"],
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

// ── Registry ────────────────────────────────────────────────────────

export const DEAL_TOOLS: Record<string, ToolEntry> = {
  findDeal,
  getDealCore,
  getRecentActivity,
  getCallDetail,
  getParticipants,
  getHealthAndRisks,
  getUpcomingMeetings,
  draftFollowUpEmail,
  addTimelineEntry,
};

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(DEAL_TOOLS).map((t) => t.definition);
}
