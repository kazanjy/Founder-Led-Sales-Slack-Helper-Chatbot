import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { sendToChatbase } from "@/lib/chatbase/client";
import type { ToolContext, ToolEntry } from "@/lib/agents/shared/types";
import { COACHING_TOOLS } from "@/lib/agents/coaching/tools";

/**
 * Tool registry for the GTM agent — the default "everything else"
 * agent that catches Slack messages the deal + coaching routers
 * don't claim. Combines:
 *
 *   1. Personal-data tools for reading the founder's GTM artifacts
 *      (sales narrative, ICP, discovery questions, etc.).
 *   2. SHARED handlers reused from the coaching agent
 *      (getMaturityStage, getLatestSalesMetrics, getCoachingState)
 *      so there's one implementation per concept.
 *   3. searchFounderLedSalesPlaybook(query) — wraps the existing
 *      Chatbase RAG path so the agent has playbook content
 *      available as a tool. Generic founder-led-sales questions
 *      ("what's MEDDICC?", "how do I handle pricing objections?")
 *      should resolve to a single call against this tool.
 *
 * The agent decides per-question whether to lean on personal data
 * tools, the playbook tool, or both. That's the routing decision
 * we previously had to make upfront with a Chatbase-vs-DIRECT
 * branch — it disappears into the tool selection.
 */

// ── Personal-data read tools ────────────────────────────────────────

// All gtm_variables-backed tools share this loader. Returns "" when
// the row doesn't exist so we don't need null-handling at every
// callsite.
async function loadGtmVariable(userId: string, mergeField: string): Promise<string> {
  const row = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField },
    select: { value: true },
  });
  return (row?.value || "").trim();
}

const getSalesNarrative: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getSalesNarrative",
      description:
        "Get the founder's full sales narrative + value props (100w / 50w / 25w). Use whenever the answer should reflect their positioning, voice, or value framing — pitching advice, message drafts, ICP questions, anything where 'how would they say it' matters.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const [narrative, vp100, vp50, vp25] = await Promise.all([
      loadGtmVariable(userId, "SALES_NARRATIVE"),
      loadGtmVariable(userId, "VALUE_PROP_100W"),
      loadGtmVariable(userId, "VALUE_PROP_50W"),
      loadGtmVariable(userId, "VALUE_PROP_25W"),
    ]);
    if (!narrative && !vp100 && !vp50 && !vp25) {
      return { error: "No sales narrative authored yet. The founder can create one at /sales-narrative." };
    }
    return {
      narrative: narrative || null,
      valueProp100w: vp100 || null,
      valueProp50w: vp50 || null,
      valueProp25w: vp25 || null,
    };
  },
};

const getICP: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getICP",
      description:
        "Get the founder's current Ideal Customer Profile — segments, firmographics, timing triggers, pain points, buying personas. Use for any 'who should we target', 'is X a good fit', 'what segments are we focused on' question.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const latest = await prisma.icpVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, createdAt: true },
    });
    if (!latest) {
      return { error: "No ICP authored yet. The founder can create one at /icp." };
    }
    return {
      icpVersionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

const getDiscoveryQuestions: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getDiscoveryQuestions",
      description:
        "Get the founder's current discovery question set. Use for any 'what should I ask on a discovery call', 'how do I uncover X', 'what's the right question for pain Y' question.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const latest = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, createdAt: true },
    });
    if (!latest) {
      return { error: "No discovery questions authored yet. The founder can create them at /discovery-questions." };
    }
    return {
      versionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

const getFirstCallChecklist: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getFirstCallChecklist",
      description:
        "Get the founder's current First Call Checklist — persona reference library, pre-call planning, rapport / introduction, discovery, opportunity evaluation. Use when answering about how to run a first call, what to prepare, what to ask, or how to qualify.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const latest = await prisma.firstCallChecklistVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, createdAt: true },
    });
    if (!latest) {
      return { error: "No First Call Checklist authored yet. The founder can create one at /first-call-checklist." };
    }
    return {
      versionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

const getColdCallScripts: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getColdCallScripts",
      description:
        "Get the founder's cold call scripts (openers, value pitches, qualifiers). Use for any 'how should I open a cold call', 'what's a good outbound script', 'how do I respond to X on a cold call' question.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const latest = await prisma.coldCallScriptVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, createdAt: true },
    });
    if (!latest) {
      return { error: "No cold call scripts authored yet. The founder can create them at /call-scripts." };
    }
    return {
      versionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

const getObjectionLibrary: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getObjectionLibrary",
      description:
        "Get the founder's catalog of objections + their responses. Use for any 'how do I handle objection X', 'what do I say when they push back on Y' question.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const objections = await prisma.objectionEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        objection: true,
        handle: true,
        category: true,
        orgPersona: true,
        humanPersona: true,
      },
    });
    if (objections.length === 0) {
      return { error: "No objections logged yet. The founder can build the library at /objection-library." };
    }
    return {
      objectionCount: objections.length,
      objections,
    };
  },
};

const getSalesDeck: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getSalesDeck",
      description:
        "Get the founder's latest sales deck content (slide-by-slide markdown). Use for 'what's in our deck', 'what slide covers X', 'how do we frame Y in the pitch' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const latest = await prisma.salesDeckVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, content: true, createdAt: true },
    });
    if (!latest) {
      return { error: "No sales deck authored yet. The founder can create one at /sales-deck." };
    }
    return {
      deckVersionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

// ── Playbook RAG tool ───────────────────────────────────────────────

const searchFounderLedSalesPlaybook: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "searchFounderLedSalesPlaybook",
      description:
        "Search the Founder-Led Sales playbook (Mikey's underlying Chatbase knowledge base — the book, frameworks, sales-coach canonical answers). Use for GENERIC founder-led-sales questions where the answer doesn't depend on the founder's own data: 'what's MEDDICC?', 'how does PLG outbound work?', 'when should I hire a sales leader?', 'what's a good ICP for SMB SaaS?'. If a question is clearly about THEIR data (their ARR, their stage, their narrative), call the personal-data tools instead. This tool is your default for any question that DOESN'T have a personal-data anchor — call it once and stop.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The user's question phrased as a query to the playbook RAG." },
        },
        required: ["query"],
      },
    },
  },
  handler: async ({ query }: { query: string }) => {
    try {
      const { response } = await sendToChatbase(query);
      return { answer: response };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Chatbase request failed.",
      };
    }
  },
};

// ── Cross-agent wrappers (don't reimplement, just delegate) ────────

// Coaching state wrapper — delegates to the coaching agent's
// whereDidWeLeaveOff handler so the GTM agent has access to "what's
// the current state of coaching" in one tool call without
// duplicating the composite logic.
const getCoachingState: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getCoachingState",
      description:
        "Composite snapshot of the founder's current coaching state: most recent session + active goals + Up Next queue + current maturity stage. Use when a question would benefit from knowing where they are right now — 'what should I focus on this week', 'what's the state of things', 'how do I unblock X' kinds of questions. If the user is asking specifically about coaching sessions / goals / metrics in detail, use the coaching-specific tools instead.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, ctx: ToolContext) => {
    // Delegate straight to the coaching agent's handler — same shape,
    // same scope checks.
    return await COACHING_TOOLS.whereDidWeLeaveOff.handler({}, ctx);
  },
};

// ── Registry ────────────────────────────────────────────────────────

export const GTM_TOOLS: Record<string, ToolEntry> = {
  // Default catch-all — playbook RAG
  searchFounderLedSalesPlaybook,
  // Personal-data tools
  getSalesNarrative,
  getICP,
  getDiscoveryQuestions,
  getFirstCallChecklist,
  getColdCallScripts,
  getObjectionLibrary,
  getSalesDeck,
  // Shared handlers reused from the coaching agent (one
  // implementation per concept; we just point at it here)
  getMaturityStage: COACHING_TOOLS.getMaturityStage,
  getLatestSalesMetrics: COACHING_TOOLS.getLatestSalesMetrics,
  // Composite wrapper that delegates to coaching
  getCoachingState,
};

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(GTM_TOOLS).map((t) => t.definition);
}
