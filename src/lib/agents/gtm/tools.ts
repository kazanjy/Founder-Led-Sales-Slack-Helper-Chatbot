import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { assessCandidate } from "@/lib/hiring/candidate-assessment";
import { sendToChatbase } from "@/lib/chatbase/client";
import type { ToolContext, ToolEntry } from "@/lib/agents/shared/types";
import { COACHING_TOOLS } from "@/lib/agents/coaching/tools";
import { DEAL_TOOLS } from "@/lib/agents/deals/tools";

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
      // ColdCallScriptVersion has no `title` — describe it via the
      // scriptType (outbound/inbound) and the persona it's tuned for
      // so the agent knows what flavor it's looking at.
      select: {
        id: true,
        scriptType: true,
        orgPersona: true,
        humanPersona: true,
        content: true,
        createdAt: true,
      },
    });
    if (!latest) {
      return { error: "No cold call scripts authored yet. The founder can create them at /call-scripts." };
    }
    return {
      versionId: latest.id,
      scriptType: latest.scriptType,
      orgPersona: latest.orgPersona,
      humanPersona: latest.humanPersona,
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
      // SalesDeckVersion has no `title` either — describe via
      // deckMode (fresh / existing / gamma) and the source PDF
      // name when relevant.
      select: {
        id: true,
        deckMode: true,
        sourcePdfName: true,
        content: true,
        createdAt: true,
      },
    });
    if (!latest) {
      return { error: "No sales deck authored yet. The founder can create one at /sales-deck." };
    }
    return {
      deckVersionId: latest.id,
      deckMode: latest.deckMode,
      sourcePdfName: latest.sourcePdfName,
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

// ── Collateral library search ─────────────────────────────────────

const searchCollateral: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "searchCollateral",
      description:
        "Search the account's Collateral Library — the founder's uploaded sales assets (PDFs, docs, one-pagers, case studies, order forms, contracts, etc.). Each asset has extracted text the agent can read. Use for 'what does our order form say', 'find the case study about X', 'pull the pricing terms from the MSA', or anything that references a specific document the founder has uploaded. Returns matching assets with title + category + extracted-text snippet + a public URL to the file. Prefer this over the playbook RAG when the user is asking about THEIR OWN uploaded material.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The user's search phrase — matched against asset name, description, and extracted text (case-insensitive).",
          },
          limit: {
            type: "number",
            description: "Max matches to return. Default 5, max 20.",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (
    { query, limit }: { query: string; limit?: number },
    ctx: ToolContext
  ) => {
    const q = (query || "").trim();
    if (!q) return { matches: [] };
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { accountId: true },
    });
    const accountId = user?.accountId ?? null;
    if (!accountId) return { matches: [], note: "No account — collateral library is per-account." };

    const cap = Math.min(Math.max(limit ?? 5, 1), 20);

    // Assets whose name/description/current-version extracted text
    // contains the query. Scoped to the caller's account. Postgres
    // ILIKE via Prisma's `mode: "insensitive"` — no FTS index yet;
    // fine at founder-scale (dozens of assets, not thousands).
    const assets = await prisma.salesAsset.findMany({
      where: {
        accountId,
        archived: false,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          {
            versions: {
              some: { extractedText: { contains: q, mode: "insensitive" } },
            },
          },
        ],
      },
      take: cap,
      orderBy: { order: "asc" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            url: true,
            label: true,
            notes: true,
            extractedText: true,
            pageCount: true,
            fileMimeType: true,
            createdAt: true,
          },
        },
      },
    });

    const snippet = (text: string | null | undefined): string => {
      if (!text) return "";
      const lc = text.toLowerCase();
      const idx = lc.indexOf(q.toLowerCase());
      if (idx < 0) return text.substring(0, 400);
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + q.length + 300);
      return (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");
    };

    return {
      matches: assets.map((a) => {
        const v = a.versions[0] || null;
        return {
          assetId: a.id,
          name: a.name,
          category: a.category,
          description: a.description,
          currentVersion: v
            ? {
                versionId: v.id,
                label: v.label,
                notes: v.notes,
                url: v.url,
                pageCount: v.pageCount,
                mimeType: v.fileMimeType,
                createdAt: v.createdAt.toISOString(),
                snippet: snippet(v.extractedText),
                hasExtractedText: !!v.extractedText,
              }
            : null,
        };
      }),
    };
  },
};

// ── Fat-context tool — load everything, let the model synthesize ──

const getFullAccountContext: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getFullAccountContext",
      description:
        "Load the WHOLE account in one shot: sales narrative + value props, the latest GTM maturity assessment (56-question Q&A), the GTM readiness tracker (catalog of capabilities + this account's status/notes per item), the full coaching corpus (every non-draft session's notes + goals + tasks + Up Next queue), the current maturity stage, and latest metric values with deltas. Use ONCE for broad strategic questions where the answer depends on the founder's whole context: 'state of our GTM', 'audit our positioning', 'what should we focus on across the board', 'what's holding us back', 'help me think through where we are'. Don't chain other tools with this — the payload already contains everything they return. Transcripts are EXCLUDED by default (they're 30K+ chars each); set includeTranscripts=true only when the user explicitly wants verbatim dialogue.",
      parameters: {
        type: "object",
        properties: {
          includeTranscripts: {
            type: "boolean",
            description:
              "When true, pasted coaching transcripts are included alongside notes. Default false. Transcripts are huge — only set true when the user is asking for exact quotes or verbatim dialogue.",
          },
        },
      },
    },
  },
  handler: async (
    { includeTranscripts }: { includeTranscripts?: boolean },
    { userId }: ToolContext
  ) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });
    const accountId = user?.accountId ?? null;

    const [
      narrative,
      vp100,
      vp50,
      vp25,
      latestAssessment,
      stageRow,
      sessions,
      goals,
      nextGoals,
      readinessAccountItems,
      metricDefs,
      collateralAssets,
    ] = await Promise.all([
      loadGtmVariable(userId, "SALES_NARRATIVE"),
      loadGtmVariable(userId, "VALUE_PROP_100W"),
      loadGtmVariable(userId, "VALUE_PROP_50W"),
      loadGtmVariable(userId, "VALUE_PROP_25W"),
      prisma.maturityAssessment.findFirst({
        where: { userId },
        orderBy: { completedAt: "desc" },
        select: { id: true, title: true, completedAt: true },
      }),
      prisma.salesMaturityStage.findUnique({
        where: { userId },
        select: { currentStage: true, updatedAt: true },
      }),
      prisma.coachingSession.findMany({
        // Account-scoped so teammates' coaching sessions are visible
        // in a claimed Slack channel / super-context grab. Falls
        // back to userId for legacy solo users with no accountId.
        where: {
          ...(accountId ? { user: { accountId } } : { userId }),
          NOT: { notes: "(draft)" },
        },
        orderBy: { sessionDate: "desc" },
        select: {
          id: true,
          title: true,
          sessionDate: true,
          sessionStatus: true,
          maturityStage: true,
          notes: true,
          // Auto-generated synthesis is the curated rollup per
          // session — included on every row of the super-context
          // dump so the agent can summarize across all of coaching
          // without re-reading the raw notes.
          synthesis: true,
          synthesisAt: true,
          recordingUrl: true,
          ...(includeTranscripts ? { transcript: true } : {}),
        },
      }),
      prisma.coachingGoal.findMany({
        where: accountId ? { user: { accountId } } : { userId },
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
            },
          },
          session: { select: { id: true, title: true, sessionDate: true } },
        },
      }),
      prisma.coachingNextGoal.findMany({
        where: accountId ? { user: { accountId } } : { userId },
        orderBy: { order: "asc" },
        include: { tasks: { select: { title: true, description: true }, orderBy: { order: "asc" } } },
      }),
      accountId
        ? prisma.salesReadinessAccountItem.findMany({
            where: { accountId },
            select: {
              status: true,
              notes: true,
              evidenceUrl: true,
              statusChangedAt: true,
              completedAt: true,
              item: {
                select: {
                  id: true,
                  maturityStage: true,
                  capabilityCategory: true,
                  title: true,
                  description: true,
                  order: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.coachingMetricDefinition.findMany({
        where: { userId, archived: false, kind: { not: "section" } },
        orderBy: { order: "asc" },
        select: { id: true, name: true, format: true },
      }),
      // Collateral library assets (account-scoped). Only title +
      // description + category + a preview of the current version's
      // extracted text land in the super-context. Full text lives
      // behind searchCollateral / getCollateralContent — dumping every
      // asset's full text here would blow up the payload.
      accountId
        ? prisma.salesAsset.findMany({
            where: { accountId, archived: false },
            orderBy: { order: "asc" },
            select: {
              id: true,
              name: true,
              description: true,
              category: true,
              slotKey: true,
              currentUrl: true,
              versions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  label: true,
                  extractedText: true,
                  pageCount: true,
                  fileMimeType: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Assessment Q&A — grouped by category, only loaded if there's an
    // assessment to load.
    const assessmentBlock = latestAssessment
      ? await (async () => {
          const answers = await prisma.maturityAnswer.findMany({
            where: { assessmentId: latestAssessment.id },
            select: {
              answer: true,
              question: { select: { category: true, globalOrder: true, question: true } },
            },
            orderBy: { question: { globalOrder: "asc" } },
          });
          const byCategory = new Map<
            string,
            Array<{ globalOrder: number; question: string; answer: string }>
          >();
          for (const a of answers) {
            const arr = byCategory.get(a.question.category) || [];
            arr.push({
              globalOrder: a.question.globalOrder,
              question: a.question.question,
              answer: a.answer,
            });
            byCategory.set(a.question.category, arr);
          }
          return {
            assessmentId: latestAssessment.id,
            title: latestAssessment.title || "Untitled assessment",
            completedAt: latestAssessment.completedAt.toISOString(),
            categories: Array.from(byCategory.entries()).map(([category, qa]) => ({
              category,
              questionAndAnswers: qa,
            })),
          };
        })()
      : null;

    // Metrics — latest + prior value + delta per metric.
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

    // Readiness — group by maturity stage → capability category for
    // readability. Each item carries the catalog title + this
    // account's status / notes / evidence.
    const readinessByStage = new Map<
      string,
      Map<
        string,
        Array<{
          title: string;
          description: string | null;
          status: string;
          notes: string | null;
          evidenceUrl: string | null;
          completedAt: string | null;
          statusChangedAt: string | null;
        }>
      >
    >();
    for (const r of readinessAccountItems) {
      const stage = r.item.maturityStage;
      const cat = r.item.capabilityCategory;
      const stageMap = readinessByStage.get(stage) || new Map();
      const catArr = stageMap.get(cat) || [];
      catArr.push({
        title: r.item.title,
        description: r.item.description,
        status: r.status,
        notes: r.notes,
        evidenceUrl: r.evidenceUrl,
        completedAt: r.completedAt?.toISOString() || null,
        statusChangedAt: r.statusChangedAt?.toISOString() || null,
      });
      stageMap.set(cat, catArr);
      readinessByStage.set(stage, stageMap);
    }
    const readinessOut = Array.from(readinessByStage.entries()).map(([stage, cats]) => ({
      maturityStage: stage,
      categories: Array.from(cats.entries()).map(([category, items]) => ({
        category,
        items,
      })),
    }));

    return {
      narrative: narrative || null,
      valueProps: {
        w100: vp100 || null,
        w50: vp50 || null,
        w25: vp25 || null,
      },
      currentMaturityStage: stageRow?.currentStage || null,
      maturityAssessment: assessmentBlock,
      readiness: {
        hasAccount: !!accountId,
        itemCount: readinessAccountItems.length,
        byStage: readinessOut,
      },
      coaching: {
        sessionCount: sessions.length,
        includeTranscripts: !!includeTranscripts,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessions: sessions.map((s: any) => ({
          sessionId: s.id,
          title: s.title,
          date: s.sessionDate.toISOString(),
          status: s.sessionStatus,
          maturityStageSnapshot: s.maturityStage,
          // Synthesis surfaced ahead of notes so the agent can read
          // the curated rollup first across the full corpus.
          synthesis: s.synthesis ?? null,
          synthesisAt: s.synthesisAt ? s.synthesisAt.toISOString() : null,
          notes: s.notes,
          transcript: includeTranscripts ? s.transcript ?? null : undefined,
          recordingUrl: s.recordingUrl,
        })),
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
      },
      metrics,
      // Collateral library index. First ~500 chars of extracted text
      // per asset (preview only — full text stays behind
      // searchCollateral). Gives the agent enough context to know
      // WHICH document to reach for without ballooning the payload.
      collateral: {
        assetCount: collateralAssets.length,
        assets: collateralAssets.map((a) => {
          const v = a.versions[0] || null;
          const preview =
            v && v.extractedText
              ? v.extractedText.substring(0, 500) +
                (v.extractedText.length > 500 ? "…" : "")
              : null;
          return {
            assetId: a.id,
            name: a.name,
            category: a.category,
            slotKey: a.slotKey,
            description: a.description,
            currentUrl: a.currentUrl,
            currentVersion: v
              ? {
                  versionId: v.id,
                  label: v.label,
                  pageCount: v.pageCount,
                  mimeType: v.fileMimeType,
                  extractedTextPreview: preview,
                  hasExtractedText: !!v.extractedText,
                }
              : null,
          };
        }),
      },
    };
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


// ── Hiring: candidate assessment ────────────────────────────────────

const assessCandidateProfile: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "assessCandidateProfile",
      description:
        "Assess a sales candidate (AE/SDR/AM) against the founder's own AE Hiring Profile, sales narrative, ICP and current GTM stage. Reconstructs what each company on their résumé WAS while they worked there (funding stage, headcount, motion, who they sold to) — the read a résumé skim can't give you — plus tenure flags and interview probes. Use whenever the founder shares a candidate: a linkedin.com/in/ URL, a pasted résumé or LinkedIn PDF export, or asks 'what do you think of this candidate'. If the message has an attached résumé/PDF, pass its extracted text as profileText. Either linkedinUrl or profileText is required; passing both gives the best read.",
      parameters: {
        type: "object",
        properties: {
          linkedinUrl: {
            type: "string",
            description: "The candidate's LinkedIn profile URL, e.g. https://www.linkedin.com/in/janedoe.",
          },
          profileText: {
            type: "string",
            description:
              "Pasted résumé / LinkedIn profile text, or the extracted text of an attached PDF. Pass the FULL text — it carries quota, self-sourced % and team-context claims the LinkedIn profile lacks.",
          },
          candidateName: {
            type: "string",
            description: "The candidate's name, when known — disambiguates a thin profile match.",
          },
          roleLabel: {
            type: "string",
            description: "Role being hired for. Defaults to AE.",
          },
        },
      },
    },
  },
  handler: async (
    {
      linkedinUrl,
      profileText,
      candidateName,
      roleLabel,
    }: { linkedinUrl?: string; profileText?: string; candidateName?: string; roleLabel?: string },
    { userId }
  ) => {
    try {
      const result = await assessCandidate({
        userId,
        linkedinUrl,
        profileText,
        candidateName,
        roleLabel,
      });
      return {
        assessmentId: result.id,
        candidate: result.candidateName,
        source: result.source,
        pdlCallsUsed: result.pdlCallsUsed,
        report: result.report,
        // Surfaced so the reply can't misreport what it graded against.
        gradedAgainst: (result.report as Record<string, unknown>).gradedAgainst,
        // Fires only on the URL-only path, i.e. exactly when the read
        // WAS thinner and saying so is useful rather than nagging.
        nudge:
          result.source === "pdl"
            ? "This read came from their LinkedIn profile alone, so it covers employers, titles, tenure and education, but nothing beyond that. Drop their résumé or a LinkedIn PDF export (profile → More → Save to PDF) into this thread and I'll re-run it: a résumé adds quota and attainment numbers, athletics including any professional career, military service, awards and whether they worked through school — none of which exist in a profile lookup, and several of which unlock green flags I couldn't evaluate here."
            : null,
        presentation:
          "Lead with the verdict headline, then the timeline showing what each company WAS during their tenure. Then the flags: report.redFlags and report.greenFlags are already ordered by severity — show the high-severity ones with their claim, their evidence, and their innocentExplanation, which is not optional. Mark any flag whose confidence is 'possible' as approximate. If report.discountedFlags is non-empty, add a short 'considered and discounted' note listing them with the suppressedBy reason — showing the work is the point. Then 2-3 interview probes, then what couldn't be verified. Do NOT add, drop, or reword a flag: the list is deterministic. Do not invent a numeric score. If `gradedAgainst.hiringProfile` is true, say you graded against their AE Hiring Profile and never claim one was missing; only if it is false may you say no profile was authored. Finally, if `nudge` is non-null, end with it in your own words — the founder got the thinner read and should know a résumé would sharpen it. If `nudge` is null they already gave us everything, so say nothing about inputs.",
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Assessment failed." };
    }
  },
};

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
  // Collateral library — uploaded PDFs / docs with extracted text.
  searchCollateral,
  // Hiring — grade a candidate against the founder's hiring bar.
  assessCandidateProfile,
  // Shared handlers reused from the coaching agent (one
  // implementation per concept; we just point at it here)
  getMaturityStage: COACHING_TOOLS.getMaturityStage,
  getMaturityAssessment: COACHING_TOOLS.getMaturityAssessment,
  getLatestSalesMetrics: COACHING_TOOLS.getLatestSalesMetrics,
  // Composite wrapper that delegates to coaching
  getCoachingState,
  // Fat-context tool — load everything in one shot, let the model
  // synthesize. Use for broad strategic questions.
  getFullAccountContext,
  // Pipeline (cross-deal) tools delegated to the deal agent's
  // registry — questions like "what's likely to close", "what's at
  // risk", "show me the funnel" land here because they don't name
  // a specific deal, so the deal router doesn't fire.
  listPipeline: DEAL_TOOLS.listPipeline,
  getPipelineSummary: DEAL_TOOLS.getPipelineSummary,
  getDealsLikelyToClose: DEAL_TOOLS.getDealsLikelyToClose,
  getDealsNeedingHelp: DEAL_TOOLS.getDealsNeedingHelp,
  getUpcomingDealActivity: DEAL_TOOLS.getUpcomingDealActivity,
};

export function getToolDefinitions(): ChatCompletionTool[] {
  return Object.values(GTM_TOOLS).map((t) => t.definition);
}
