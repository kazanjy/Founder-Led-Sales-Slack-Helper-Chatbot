import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import type { ToolContext, ToolEntry } from "@/lib/agents/shared/types";

// Re-export so existing code that pulled these from this module keeps
// working without touching every callsite.
export type { ToolContext, ToolEntry };

/**
 * Tool registry for the per-account Mikey coaching agent (phase 1).
 * See companion src/lib/agents/deals/tools.ts. Shared handler types
 * live in src/lib/agents/shared/types.ts so the GTM agent can
 * compose tools across modules.
 */

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Scoping helper for coaching-tied reads (CoachingSession /
 * CoachingGoal / CoachingTask / CoachingNextGoal). When the caller
 * belongs to an account we scope by user.accountId so account
 * teammates' sessions are visible in claimed Slack channels — same
 * behavior the web /coaching-history page has. Solo users (no
 * accountId) fall back to the per-user filter.
 *
 * NOTE: personal-state models (SalesMaturityStage, MaturityAssessment,
 * CoachingMetricDefinition, GtmVariable) stay userId-scoped even when
 * accountId is present, because each teammate has their own stage /
 * assessment / metrics / narrative and pulling teammates' rows in
 * a claimed channel would confuse the model.
 */
function coachingScope(ctx: ToolContext): { userId: string } | { user: { accountId: string } } {
  return ctx.accountId
    ? { user: { accountId: ctx.accountId } }
    : { userId: ctx.userId };
}

async function loadSessionForUser(ctx: ToolContext, sessionId: string) {
  return prisma.coachingSession.findFirst({
    where: { id: sessionId, ...coachingScope(ctx) },
  });
}

function diffDays(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function isSettled(status: string | null | undefined): boolean {
  return status === "done" || status === "not_doing" || status === "deprioritized";
}

// ── Tools ───────────────────────────────────────────────────────────

const findCoachingSession: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "findCoachingSession",
      description:
        "Resolve a loose reference to a coaching session (a date, a title fragment, 'most recent', 'last week', 'the one where we talked about hiring', etc.) into one or more candidate sessionIds. ALWAYS call this first when the user references a specific session — every other per-session tool needs a sessionId. Returns up to 5 candidates ordered most-recent first with a confidence score.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The user's reference — e.g. 'last session', 'most recent', '2026-06-15', 'sprint review', 'the one about pricing'. Pass an empty string when the user just wants the most recent session.",
          },
          startDate: {
            type: "string",
            description: "Optional ISO yyyy-mm-dd lower bound for sessionDate.",
          },
          endDate: {
            type: "string",
            description: "Optional ISO yyyy-mm-dd upper bound for sessionDate.",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (
    { query, startDate, endDate }: { query: string; startDate?: string; endDate?: string },
    ctx
  ) => {
    const where: Record<string, unknown> = {
      ...coachingScope(ctx),
      // Filter out draft sessions — they're auto-created placeholders
      // with notes: "(draft)" and don't represent real coaching.
      NOT: { notes: "(draft)" },
    };
    if (startDate || endDate) {
      const filter: Record<string, Date> = {};
      if (startDate) filter.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) filter.lte = new Date(`${endDate}T23:59:59.999Z`);
      where.sessionDate = filter;
    }
    const sessions = await prisma.coachingSession.findMany({
      where,
      orderBy: { sessionDate: "desc" },
      take: 60,
      select: {
        id: true,
        title: true,
        sessionDate: true,
        sessionStatus: true,
        notes: true,
      },
    });
    if (sessions.length === 0) return { candidates: [], note: "No sessions match." };

    const q = (query || "").trim().toLowerCase();
    // Heuristic scoring. Recency is the base signal; substring
    // matches on title/notes bump the score.
    const now = Date.now();
    // "Give me the most recent" intent — fires on empty query, or
    // when the query carries a recency word ("last", "latest", "most
    // recent", "previous", "recent") regardless of what sits between
    // it and "session"/"coaching"/etc. The old regex required `last`
    // to butt up against `session`, which missed obvious phrasings
    // like "our last coaching session" or just "the last one".
    const wantsMostRecent =
      q === "" || /\b(most\s*recent|latest|previous|recent|last)\b/.test(q);
    const scored = sessions.map((s, idx) => {
      let score = Math.max(0, 100 - idx * 2); // recency base
      if (q) {
        const hay = `${s.title} ${(s.notes || "").slice(0, 600)}`.toLowerCase();
        if (s.title.toLowerCase() === q) score += 100;
        else if (s.title.toLowerCase().includes(q)) score += 60;
        else if (hay.includes(q)) score += 30;
      }
      if (wantsMostRecent && idx === 0) {
        score += 80;
      }
      return { s, score };
    });
    const top = scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ s, score }) => ({
        sessionId: s.id,
        title: s.title,
        date: s.sessionDate.toISOString(),
        daysAgo: diffDays(new Date(now), s.sessionDate),
        status: s.sessionStatus,
        confidence: score >= 130 ? "high" : score >= 80 ? "medium" : "low",
      }));
    return { candidates: top, totalChecked: sessions.length };
  },
};

const getCoachingSession: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getCoachingSession",
      description:
        "Fetch the full contents of one coaching session: title, date, lifecycle status, the auto-generated Session Synthesis (the four-section 'What we discussed / agreed / top priorities / what's next' rollup that lives on the coaching page), the markdown notes, the optional pasted transcript, attached recording URL, and a count of goals/tasks attached. Use for any 'what was discussed', 'summarize this session', 'what was decided' question — and lean on the synthesis first if it's present (it's a tight curated rollup; notes/transcript are the raw source). For goals/tasks lists call getCoachingGoalsAndTasks instead.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "The session's id (from findCoachingSession)." },
        },
        required: ["sessionId"],
      },
    },
  },
  handler: async ({ sessionId }: { sessionId: string }, ctx) => {
    const s = await loadSessionForUser(ctx, sessionId);
    if (!s) return { error: "Session not found or not accessible." };
    const [goalsCount, tasksCount] = await Promise.all([
      prisma.coachingGoal.count({ where: { sessionId } }),
      prisma.coachingTask.count({ where: { goal: { sessionId } } }),
    ]);
    return {
      sessionId: s.id,
      title: s.title,
      date: s.sessionDate.toISOString(),
      status: s.sessionStatus,
      maturityStageSnapshot: s.maturityStage,
      // Surfaced first so the agent reads the curated rollup before
      // the raw notes/transcript when both exist. Null until the
      // session is saved with the synthesizer enabled.
      synthesis: s.synthesis,
      synthesisAt: s.synthesisAt?.toISOString() || null,
      notes: s.notes,
      transcript: s.transcript,
      recordingUrl: s.recordingUrl,
      goalCount: goalsCount,
      taskCount: tasksCount,
      createdAt: s.createdAt.toISOString(),
    };
  },
};

const getCoachingGoalsAndTasks: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getCoachingGoalsAndTasks",
      description:
        "List the user's coaching goals + tasks. `scope` controls what's returned: 'session' (only goals/tasks attached to a specific session — pass sessionId), 'active' (all currently-active goals across every session — default), or 'all' (every goal regardless of status). Each goal includes its tasks + subtasks with status, priority, and the date the status last changed. Use for any 'what goals are we working on', 'what's still active', 'what's done', or 'what's the queue' question.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["session", "active", "all"],
            description: "Which goals to return. Default: 'active'.",
          },
          sessionId: {
            type: "string",
            description: "Required when scope = 'session'. Ignored otherwise.",
          },
        },
      },
    },
  },
  handler: async (
    { scope, sessionId }: { scope?: "session" | "active" | "all"; sessionId?: string },
    ctx
  ) => {
    const effectiveScope = scope || "active";
    const where: Record<string, unknown> = { ...coachingScope(ctx) };
    if (effectiveScope === "session") {
      if (!sessionId) return { error: "scope='session' requires a sessionId." };
      where.sessionId = sessionId;
    } else if (effectiveScope === "active") {
      where.status = "active";
    }
    const goals = await prisma.coachingGoal.findMany({
      where,
      orderBy: [{ status: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      include: {
        tasks: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            parentTaskId: true,
            statusChangedAt: true,
            createdAt: true,
          },
        },
        session: { select: { id: true, title: true, sessionDate: true } },
      },
      take: 40,
    });
    return {
      scope: effectiveScope,
      goals: goals.map((g) => ({
        goalId: g.id,
        title: g.title,
        description: g.description,
        status: g.status,
        statusChangedAt: g.statusChangedAt?.toISOString() || null,
        createdAt: g.createdAt.toISOString(),
        nativeSessionId: g.sessionId,
        nativeSessionTitle: g.session.title,
        nativeSessionDate: g.session.sessionDate.toISOString(),
        tasks: g.tasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          parentTaskId: t.parentTaskId,
          statusChangedAt: t.statusChangedAt?.toISOString() || null,
          createdAt: t.createdAt.toISOString(),
        })),
      })),
    };
  },
};

const getRecentCoachingActivity: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getRecentCoachingActivity",
      description:
        "What has actually happened in coaching recently? Returns the most recent N sessions (default 4) with each session's date, title, locked-or-live status, a count of goals/tasks attached, and a peek at the first ~400 chars of the notes. Use for 'what's been going on', 'what have we been working on', 'how often do we meet' kinds of questions.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "How many recent sessions to return. Default 4, max 12.",
          },
        },
      },
    },
  },
  handler: async ({ limit }: { limit?: number }, ctx) => {
    const cap = Math.min(Math.max(limit ?? 4, 1), 12);
    const sessions = await prisma.coachingSession.findMany({
      where: { ...coachingScope(ctx), NOT: { notes: "(draft)" } },
      orderBy: { sessionDate: "desc" },
      take: cap,
      select: {
        id: true,
        title: true,
        sessionDate: true,
        sessionStatus: true,
        notes: true,
        synthesis: true,
        _count: { select: { goals: true } },
      },
    });
    return {
      sessions: sessions.map((s) => ({
        sessionId: s.id,
        title: s.title,
        date: s.sessionDate.toISOString(),
        status: s.sessionStatus,
        goalCount: s._count.goals,
        // Auto-generated synthesis is ~300 words so we return it in
        // full when present — it's the curated rollup the founder
        // sees on the coaching page. notesPreview stays as a raw
        // fallback for sessions saved before the synthesizer existed.
        synthesis: s.synthesis,
        notesPreview:
          (s.notes || "").substring(0, 400) + ((s.notes?.length || 0) > 400 ? "…" : ""),
      })),
    };
  },
};

const getMaturityStage: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getMaturityStage",
      description:
        "The user's current GTM maturity stage. Returns one of PROBLEM_VALIDATION, VALUE_VALIDATION, FIRST_REVENUE, REPEATABLE_REVENUE, FIRST_SALES_HIRE, SCALING_SALES, or null if never set. Use whenever the user asks about their stage, where they are in the journey, or what the right priorities for their stage are.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId }) => {
    const row = await prisma.salesMaturityStage.findUnique({
      where: { userId },
      select: { currentStage: true, updatedAt: true },
    });
    return {
      currentStage: row?.currentStage || null,
      setAt: row?.updatedAt?.toISOString() || null,
    };
  },
};

const getMaturityAssessment: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getMaturityAssessment",
      description:
        "Pull the founder's most recent GTM maturity assessment — the 56-question Q&A across Revenue Basics, Value Prop, ICP, Discovery, Pricing, Pipeline, Hiring, etc. — with their actual answers, grouped by category. This is the deep context behind the stage label that getMaturityStage returns. Use whenever the question would benefit from knowing what the founder said about their business: 'what's our ICP-fit story', 'how did we describe pricing', 'what hiring gaps did we flag', or anytime you'd otherwise want to ask the founder a question the assessment already answered. Optionally returns the list of all prior assessments (history) for trend / evolution questions.",
      parameters: {
        type: "object",
        properties: {
          assessmentId: {
            type: "string",
            description: "Specific assessment id to load. Default: most recent assessment.",
          },
          includeHistory: {
            type: "boolean",
            description:
              "When true, also returns a list of all prior assessments (id, title, completedAt) so you can ask follow-up about earlier ones. Default false.",
          },
        },
      },
    },
  },
  handler: async (
    { assessmentId, includeHistory }: { assessmentId?: string; includeHistory?: boolean },
    { userId }
  ) => {
    const target = assessmentId
      ? await prisma.maturityAssessment.findFirst({
          where: { id: assessmentId, userId },
          select: { id: true, title: true, completedAt: true },
        })
      : await prisma.maturityAssessment.findFirst({
          where: { userId },
          orderBy: { completedAt: "desc" },
          select: { id: true, title: true, completedAt: true },
        });
    if (!target) {
      return {
        error:
          "No maturity assessment found. The founder can take one at /maturity-assessment.",
      };
    }
    const [answers, stageRow, history] = await Promise.all([
      prisma.maturityAnswer.findMany({
        where: { assessmentId: target.id },
        select: {
          answer: true,
          question: { select: { category: true, globalOrder: true, question: true } },
        },
        orderBy: { question: { globalOrder: "asc" } },
      }),
      prisma.salesMaturityStage.findUnique({
        where: { userId },
        select: { currentStage: true },
      }),
      includeHistory
        ? prisma.maturityAssessment.findMany({
            where: { userId },
            orderBy: { completedAt: "desc" },
            select: { id: true, title: true, completedAt: true },
          })
        : Promise.resolve(null),
    ]);
    // Group Q&A by category so the agent gets a structure that maps
    // to the assessment UI (Revenue Basics / Value Prop / ICP / etc.).
    const byCategory = new Map<string, Array<{ globalOrder: number; question: string; answer: string }>>();
    for (const a of answers) {
      const cat = a.question.category;
      const arr = byCategory.get(cat) || [];
      arr.push({
        globalOrder: a.question.globalOrder,
        question: a.question.question,
        answer: a.answer,
      });
      byCategory.set(cat, arr);
    }
    return {
      assessmentId: target.id,
      title: target.title || "Untitled assessment",
      completedAt: target.completedAt.toISOString(),
      currentStage: stageRow?.currentStage || null,
      categories: Array.from(byCategory.entries()).map(([category, qa]) => ({
        category,
        questionAndAnswers: qa,
      })),
      ...(includeHistory && history
        ? {
            history: history.map((h) => ({
              assessmentId: h.id,
              title: h.title || "Untitled assessment",
              completedAt: h.completedAt.toISOString(),
            })),
          }
        : {}),
    };
  },
};

const getLatestSalesMetrics: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getLatestSalesMetrics",
      description:
        "Most recent values for each of the user's coaching metrics (ARR, customer count, pipeline, MQLs, etc.) plus the prior session's value + delta. Use for 'what's our latest ARR', 'how many customers do we have', 'how have the numbers moved'. Optionally filter to a subset of metrics by name.",
      parameters: {
        type: "object",
        properties: {
          metricNames: {
            type: "array",
            items: { type: "string" },
            description: "Optional filter: substring match (case-insensitive) on metric name.",
          },
        },
      },
    },
  },
  handler: async ({ metricNames }: { metricNames?: string[] }, { userId }) => {
    const defs = await prisma.coachingMetricDefinition.findMany({
      where: { userId, archived: false, kind: { not: "section" } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, definition: true, format: true },
    });
    const filtered = metricNames && metricNames.length > 0
      ? defs.filter((d) => {
          const lc = d.name.toLowerCase();
          return metricNames.some((q) => lc.includes(q.toLowerCase()));
        })
      : defs;
    if (filtered.length === 0) {
      return { metrics: [], note: metricNames ? "No matching metrics." : "No metrics defined yet." };
    }
    // For each metric, pull the two most recent entries (current + prior).
    const out = await Promise.all(
      filtered.map(async (d) => {
        const recent = await prisma.coachingMetricEntry.findMany({
          where: { metricDefinitionId: d.id, session: { notes: { not: "(draft)" } } },
          orderBy: [
            { session: { sessionDate: "desc" } },
            { session: { createdAt: "desc" } },
          ],
          take: 2,
          select: {
            currentValue: true,
            session: { select: { sessionDate: true } },
          },
        });
        const latest = recent[0];
        const prior = recent[1];
        return {
          name: d.name,
          definition: d.definition,
          format: d.format,
          latestValue: latest?.currentValue ?? null,
          latestSessionDate: latest?.session.sessionDate.toISOString() || null,
          priorValue: prior?.currentValue ?? null,
          priorSessionDate: prior?.session.sessionDate.toISOString() || null,
          delta:
            latest != null && prior != null
              ? latest.currentValue - prior.currentValue
              : null,
        };
      })
    );
    return { metrics: out };
  },
};

const summarizeCoachingSession: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "summarizeCoachingSession",
      description:
        "Gather the full context of a coaching session — notes, transcript, attached goals/tasks/maturity stage — and return it with a synthesis directive instructing YOU to write the takeaway doc in three sections: ## What we discussed, ## Agreements & priorities until next session, ## What we'll turn to after immediate priorities. Same shape as the in-app auto-synthesis. Use when the user asks to summarize, write up, or pull takeaways from a session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
        required: ["sessionId"],
      },
    },
  },
  handler: async ({ sessionId }: { sessionId: string }, ctx) => {
    const s = await loadSessionForUser(ctx, sessionId);
    if (!s) return { error: "Session not found or not accessible." };
    const goals = await prisma.coachingGoal.findMany({
      where: { sessionId },
      include: {
        tasks: {
          select: {
            title: true,
            status: true,
            priority: true,
            parentTaskId: true,
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { order: "asc" },
    });
    return {
      session: {
        title: s.title,
        date: s.sessionDate.toISOString(),
        notes: s.notes,
        transcript: s.transcript,
        maturityStageSnapshot: s.maturityStage,
      },
      goals: goals.map((g) => ({
        title: g.title,
        status: g.status,
        tasks: g.tasks.map((t) => ({
          title: t.title,
          status: t.status,
          priority: t.priority,
          isSubtask: !!t.parentTaskId,
        })),
      })),
      directive: `Write the takeaway doc now with EXACTLY these three sections, no preamble, no sign-off. Specifics from the session — names, deals, numbers — not generic coach-speak.

## What we discussed
3-6 bullets of the substantive topics in the order they shaped the conversation.

## Agreements & priorities until next session
EVERY decision, commitment, and priority that landed — exhaustive, a commitment appears once (never restated). Bundle by initiative (top-level bullet per goal/body of work, ranked P0 → P1 → P2 → unranked with [P0]-style tags); nested beneath each: DECISIONS first (resolved statements — "we'll move X to Y", not "we discussed"), then ACTIONS ranked by priority, each with owner (default: founder) and a "done when …" signal. No "continue working on X" — name the next move.

## What we'll turn to after immediate priorities
2-4 bullets of work queued for "after we land the top priorities". Each: what it is + the trigger/readiness signal that says it's time. Write "Nothing queued — re-evaluate next session." if there's nothing on deck.

Terse bullets; the combined section runs as long as the actual agreements require.`,
    };
  },
};

const whereDidWeLeaveOff: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "whereDidWeLeaveOff",
      description:
        "Composite 'state of things' tool. Returns the most recent session's title/date/notes preview, the user's current active goals + top-priority tasks, the queued 'Up Next' goals + tasks, and current maturity stage — everything needed to answer 'where did we leave off and what's next' in a single tool call. Don't call this in addition to the other tools; use it INSTEAD of chaining them.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, ctx) => {
    const scope = coachingScope(ctx);
    const [latestSession, activeGoals, nextGoals, maturity] = await Promise.all([
      prisma.coachingSession.findFirst({
        where: { ...scope, NOT: { notes: "(draft)" } },
        orderBy: { sessionDate: "desc" },
        select: {
          id: true,
          title: true,
          sessionDate: true,
          sessionStatus: true,
          notes: true,
          synthesis: true,
        },
      }),
      prisma.coachingGoal.findMany({
        where: { ...scope, status: "active" },
        orderBy: { order: "asc" },
        include: {
          tasks: {
            where: { status: "active" },
            orderBy: [{ priority: "asc" }, { order: "asc" }],
            select: { title: true, priority: true, parentTaskId: true },
            take: 8,
          },
          session: { select: { title: true, sessionDate: true } },
        },
        take: 15,
      }),
      prisma.coachingNextGoal.findMany({
        where: scope,
        orderBy: { order: "asc" },
        include: {
          tasks: { select: { title: true }, orderBy: { order: "asc" } },
        },
        take: 12,
      }),
      // Maturity stage stays user-scoped — each teammate has their
      // own stage; in a claimed channel we want the channel owner's.
      prisma.salesMaturityStage.findUnique({
        where: { userId: ctx.userId },
        select: { currentStage: true },
      }),
    ]);
    return {
      latestSession: latestSession
        ? {
            sessionId: latestSession.id,
            title: latestSession.title,
            date: latestSession.sessionDate.toISOString(),
            status: latestSession.sessionStatus,
            // Synthesis is the curated rollup the founder reads on
            // the coaching page — lean on it for "where did we leave
            // off" answers. notesPreview is the raw fallback for
            // sessions without a synthesis yet.
            synthesis: latestSession.synthesis,
            notesPreview:
              (latestSession.notes || "").substring(0, 600) +
              ((latestSession.notes?.length || 0) > 600 ? "…" : ""),
          }
        : null,
      currentMaturityStage: maturity?.currentStage || null,
      activeGoals: activeGoals.map((g) => ({
        goalId: g.id,
        title: g.title,
        nativeSessionTitle: g.session.title,
        nativeSessionDate: g.session.sessionDate.toISOString(),
        topActiveTasks: g.tasks.map((t) => ({
          title: t.title,
          priority: t.priority,
          isSubtask: !!t.parentTaskId,
        })),
      })),
      upNext: nextGoals.map((g) => ({
        goalId: g.id,
        title: g.title,
        description: g.description,
        tasks: g.tasks.map((t) => t.title),
      })),
    };
  },
};

const searchCoachingHistory: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "searchCoachingHistory",
      description:
        "Keyword search across coaching session notes + transcripts + goal/task titles for the user. Use when the user asks 'did we ever talk about X', 'when did we decide Y', 'has Z come up before'. Returns up to 8 matches with snippet + session reference. Substring match is case-insensitive — for the best recall pass distinct words rather than full phrases.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms." },
        },
        required: ["query"],
      },
    },
  },
  handler: async ({ query }: { query: string }, ctx) => {
    const q = (query || "").trim();
    if (!q) return { matches: [] };
    const scope = coachingScope(ctx);
    // Search sessions, goals, tasks in parallel. Cap results per
    // bucket so a session with the query repeated 30 times doesn't
    // drown out matches elsewhere.
    const [sessionHits, goalHits, taskHits] = await Promise.all([
      prisma.coachingSession.findMany({
        where: {
          ...scope,
          NOT: { notes: "(draft)" },
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { transcript: { contains: q, mode: "insensitive" } },
            // The auto-generated synthesis often phrases things more
            // concisely than the raw notes ("we agreed to drop X")
            // and is a strong match surface for "did we ever talk
            // about Y" / "when did we decide Z" queries.
            { synthesis: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { sessionDate: "desc" },
        take: 4,
        select: { id: true, title: true, sessionDate: true, notes: true, synthesis: true },
      }),
      prisma.coachingGoal.findMany({
        where: {
          ...scope,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          id: true,
          title: true,
          status: true,
          session: { select: { id: true, title: true, sessionDate: true } },
        },
      }),
      prisma.coachingTask.findMany({
        where: {
          ...scope,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          goal: {
            select: { title: true, session: { select: { id: true, title: true, sessionDate: true } } },
          },
        },
      }),
    ]);
    const snippet = (text: string | null) => {
      if (!text) return "";
      const lc = text.toLowerCase();
      const idx = lc.indexOf(q.toLowerCase());
      if (idx < 0) return text.substring(0, 240);
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + q.length + 160);
      return (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");
    };
    return {
      sessionMatches: sessionHits.map((s) => {
        // Prefer a snippet from the synthesis when the query lives
        // there (tighter language); fall back to the raw notes
        // otherwise. The agent gets both fields so it can decide.
        const lc = s.synthesis?.toLowerCase() || "";
        const matchedSynthesis =
          lc && lc.indexOf(q.toLowerCase()) >= 0
            ? snippet(s.synthesis)
            : null;
        return {
          sessionId: s.id,
          title: s.title,
          date: s.sessionDate.toISOString(),
          snippet: matchedSynthesis || snippet(s.notes),
          matchedFrom: matchedSynthesis ? "synthesis" : "notes",
        };
      }),
      goalMatches: goalHits.map((g) => ({
        goalId: g.id,
        title: g.title,
        status: g.status,
        nativeSessionId: g.session.id,
        nativeSessionTitle: g.session.title,
        nativeSessionDate: g.session.sessionDate.toISOString(),
      })),
      taskMatches: taskHits.map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        goalTitle: t.goal.title,
        nativeSessionId: t.goal.session.id,
        nativeSessionTitle: t.goal.session.title,
        nativeSessionDate: t.goal.session.sessionDate.toISOString(),
      })),
    };
  },
};

const getFullCoachingHistory: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getFullCoachingHistory",
      description:
        "Pull the ENTIRE coaching corpus in one shot — every non-draft session with its title/date/status/notes, every goal across every session with its full task list (any status), the Up Next queue, the current maturity stage, and recent metric snapshots. Use when the user wants to chat with the totality of their coaching history: 'what themes have come up across all our sessions?', 'how has my thinking evolved?', 'pull together everything we've discussed about hiring'. The payload can be large — only use this when the question genuinely spans all of history. Transcripts are EXCLUDED by default to keep token cost manageable; set includeTranscripts=true if the user explicitly wants transcript-level detail.",
      parameters: {
        type: "object",
        properties: {
          includeTranscripts: {
            type: "boolean",
            description:
              "Default false. When true, pasted transcripts are included alongside notes. Transcripts can be 30K+ chars each — only set true when the user is asking about literal dialogue, exact quotes, or transcript-level evidence.",
          },
          sessionLimit: {
            type: "number",
            description:
              "Max number of sessions to return (most-recent first). Default 50. Most accounts have well under this.",
          },
        },
      },
    },
  },
  handler: async (
    { includeTranscripts, sessionLimit }: { includeTranscripts?: boolean; sessionLimit?: number },
    ctx
  ) => {
    const cap = Math.min(Math.max(sessionLimit ?? 50, 1), 100);
    const scope = coachingScope(ctx);
    const [sessions, goals, nextGoals, maturity, metricDefs] = await Promise.all([
      prisma.coachingSession.findMany({
        where: { ...scope, NOT: { notes: "(draft)" } },
        orderBy: { sessionDate: "desc" },
        take: cap,
        select: {
          id: true,
          title: true,
          sessionDate: true,
          sessionStatus: true,
          maturityStage: true,
          notes: true,
          // Auto-generated synthesis — included on every session in
          // the corpus tool because it's the curated rollup the agent
          // should reach for first when summarizing across history.
          synthesis: true,
          synthesisAt: true,
          // Only pull transcript when asked — it's the biggest field
          // by far and Prisma will skip the column read when omitted.
          ...(includeTranscripts ? { transcript: true } : {}),
          recordingUrl: true,
        },
      }),
      prisma.coachingGoal.findMany({
        where: scope,
        orderBy: [{ status: "asc" }, { order: "asc" }, { createdAt: "asc" }],
        include: {
          tasks: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              parentTaskId: true,
              statusChangedAt: true,
              createdAt: true,
            },
          },
          session: { select: { id: true, title: true, sessionDate: true } },
        },
      }),
      prisma.coachingNextGoal.findMany({
        where: scope,
        orderBy: { order: "asc" },
        include: { tasks: { select: { title: true, description: true }, orderBy: { order: "asc" } } },
      }),
      // Maturity + metric definitions stay user-scoped (personal
      // state; teammates have their own).
      prisma.salesMaturityStage.findUnique({
        where: { userId: ctx.userId },
        select: { currentStage: true, updatedAt: true },
      }),
      prisma.coachingMetricDefinition.findMany({
        where: { userId: ctx.userId, archived: false, kind: { not: "section" } },
        orderBy: { order: "asc" },
        select: { id: true, name: true, format: true },
      }),
    ]);

    // For each metric, pull the latest two entries so we can show the
    // current value + the delta from the prior session.
    const metrics = await Promise.all(
      metricDefs.map(async (d) => {
        const recent = await prisma.coachingMetricEntry.findMany({
          where: { metricDefinitionId: d.id, session: { notes: { not: "(draft)" } } },
          orderBy: [
            { session: { sessionDate: "desc" } },
            { session: { createdAt: "desc" } },
          ],
          take: 2,
          select: { currentValue: true, session: { select: { sessionDate: true } } },
        });
        const latest = recent[0];
        const prior = recent[1];
        return {
          name: d.name,
          format: d.format,
          latestValue: latest?.currentValue ?? null,
          latestSessionDate: latest?.session.sessionDate.toISOString() || null,
          priorValue: prior?.currentValue ?? null,
          delta:
            latest != null && prior != null
              ? latest.currentValue - prior.currentValue
              : null,
        };
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shapedSessions = sessions.map((s: any) => ({
      sessionId: s.id,
      title: s.title,
      date: s.sessionDate.toISOString(),
      status: s.sessionStatus,
      maturityStageSnapshot: s.maturityStage,
      // Synthesis is the curated rollup; surfaced ahead of notes/
      // transcript so the agent leans on it first for cross-session
      // summarization.
      synthesis: s.synthesis ?? null,
      synthesisAt: s.synthesisAt ? s.synthesisAt.toISOString() : null,
      notes: s.notes,
      transcript: includeTranscripts ? s.transcript ?? null : undefined,
      recordingUrl: s.recordingUrl,
    }));

    return {
      sessionCount: shapedSessions.length,
      includeTranscripts: !!includeTranscripts,
      currentMaturityStage: maturity?.currentStage || null,
      sessions: shapedSessions,
      goals: goals.map((g) => ({
        goalId: g.id,
        title: g.title,
        description: g.description,
        status: g.status,
        statusChangedAt: g.statusChangedAt?.toISOString() || null,
        nativeSessionId: g.session.id,
        nativeSessionTitle: g.session.title,
        nativeSessionDate: g.session.sessionDate.toISOString(),
        tasks: g.tasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          parentTaskId: t.parentTaskId,
        })),
      })),
      upNext: nextGoals.map((g) => ({
        goalId: g.id,
        title: g.title,
        description: g.description,
        tasks: g.tasks.map((t) => ({ title: t.title, description: t.description })),
      })),
      metrics,
    };
  },
};

const addCoachingNote: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "addCoachingNote",
      description:
        "Append a note to a coaching session. Defaults to the most recent live (non-locked) session if no sessionId is given. Refuses to write to a locked session. Use when the user says 'jot this down', 'log that we agreed X', 'remember Y for next session'. This is the ONLY mutating tool in the coaching surface. After calling, tell the user what was written.",
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Optional. If omitted, the most recent live session is used.",
          },
          content: { type: "string", description: "The text to append." },
        },
        required: ["content"],
      },
    },
  },
  handler: async (
    { sessionId, content }: { sessionId?: string; content: string },
    ctx
  ) => {
    const { userId } = ctx;
    // Explicit-id path is account-scoped (a teammate's session id is
    // valid if the caller belongs to the same account); implicit
    // fallback stays user-scoped so "jot this down" writes to the
    // context user's most recent live session, not some teammate's.
    let session = sessionId
      ? await loadSessionForUser(ctx, sessionId)
      : await prisma.coachingSession.findFirst({
          where: { userId, sessionStatus: { not: "locked" }, NOT: { notes: "(draft)" } },
          orderBy: { sessionDate: "desc" },
        });
    if (!session) {
      return {
        error:
          "No accessible non-locked session found. The user may want to create a new session first.",
      };
    }
    if (session.sessionStatus === "locked") {
      return { error: `Session "${session.title}" is locked — notes can't be appended.` };
    }
    const appended = (session.notes || "") +
      ((session.notes && !session.notes.endsWith("\n")) ? "\n\n" : "") +
      content.trim();
    session = await prisma.coachingSession.update({
      where: { id: session.id },
      data: { notes: appended },
    });
    return {
      sessionId: session.id,
      sessionTitle: session.title,
      sessionDate: session.sessionDate.toISOString(),
      noteAppended: content.trim(),
      confirmation: `Appended to "${session.title}".`,
    };
  },
};

// Silence unused-helper warnings until we lean on isSettled in a
// future tool.
void isSettled;

// ── Registry ────────────────────────────────────────────────────────

export const COACHING_TOOLS: Record<string, ToolEntry> = {
  findCoachingSession,
  getCoachingSession,
  getCoachingGoalsAndTasks,
  getRecentCoachingActivity,
  getMaturityStage,
  getMaturityAssessment,
  getLatestSalesMetrics,
  summarizeCoachingSession,
  whereDidWeLeaveOff,
  searchCoachingHistory,
  getFullCoachingHistory,
  addCoachingNote,
};

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(COACHING_TOOLS).map((t) => t.definition);
}
