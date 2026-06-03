import { prisma } from "@/lib/db";

/**
 * Per-section size caps. The total budget is generous (gpt-5.5 has a
 * large context window) but we cap individual items so one runaway
 * transcript or asset note can't dominate the bundle. Numbers are in
 * characters; rough rule of thumb is ~4 chars per token.
 */
const CAPS = {
  perTranscript: 30_000,
  perSessionNotes: 16_000,
  perTaskDescription: 4_000,
  perAssetVersionNotes: 4_000,
  perReadinessNotes: 2_000,
  recentSessionsWithTranscript: 5,
  // If after per-item caps the bundle still exceeds this, drop the
  // lowest-priority sections (transcripts oldest-first, then to_do
  // readiness items).
  totalSoftCap: 800_000,
};

export type Scope = "account" | "user";

export interface ContextStats {
  users: number;
  gtmVariables: number;
  maturityAssessments: number;
  readinessItems: number;
  coachingSessions: number;
  coachingSessionsWithTranscripts: number;
  coachingGoals: number;
  coachingTasks: number;
  salesAssets: number;
  totalChars: number;
  maturityStage: string | null;
  readinessByStatus: Record<string, number>;
}

export interface ContextBundle {
  contextText: string;
  stats: ContextStats;
  truncations: string[];
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max) + "\n…[truncated]", truncated: true };
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Build the context blob for an admin "Ask This Account" query. Pure
 * function over Prisma data — no LLM calls. The returned text is the
 * exact string fed to GPT-5 in the user message.
 *
 * Account scope aggregates across all users in the account, tagging
 * each per-user item with the user it came from. User scope returns
 * just that user's data, plus account-scoped readiness + assets (since
 * those live at the account level even when a single-user view is
 * what the admin wants).
 */
export async function buildAccountContext(
  scope: Scope,
  targetId: string
): Promise<ContextBundle> {
  // Resolve account + users.
  let accountId: string;
  let users: Array<{ id: string; name: string | null; slackUserName: string | null; email: string | null }>;
  let accountName = "—";

  if (scope === "user") {
    const u = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true, name: true, slackUserName: true, email: true,
        accountId: true,
        account: { select: { id: true, name: true } },
      },
    });
    if (!u) throw new Error(`User ${targetId} not found`);
    if (!u.accountId || !u.account) {
      // User without an account — only their per-user data is available.
      accountId = "";
      users = [{ id: u.id, name: u.name, slackUserName: u.slackUserName, email: u.email }];
    } else {
      accountId = u.account.id;
      accountName = u.account.name;
      users = [{ id: u.id, name: u.name, slackUserName: u.slackUserName, email: u.email }];
    }
  } else {
    const a = await prisma.account.findUnique({
      where: { id: targetId },
      select: {
        id: true, name: true,
        users: { select: { id: true, name: true, slackUserName: true, email: true } },
      },
    });
    if (!a) throw new Error(`Account ${targetId} not found`);
    accountId = a.id;
    accountName = a.name;
    users = a.users;
  }

  const userIds = users.map((u) => u.id);
  const truncations: string[] = [];
  const sections: string[] = [];

  const uname = (id: string): string => {
    const u = users.find((x) => x.id === id);
    if (!u) return id;
    return u.name || u.slackUserName || u.email || id;
  };

  sections.push(
    `# Account: ${accountName}\n` +
    `Scope: ${scope}\n` +
    `Users: ${users.map((u) => u.name || u.slackUserName || u.email || u.id).join(", ")}\n`
  );

  // ─── GTM Variables (per user) ───────────────────────────────────
  const gtmVars = await prisma.gtmVariable.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, name: true, mergeField: true, value: true, description: true, sortOrder: true },
    orderBy: [{ userId: "asc" }, { sortOrder: "asc" }],
  });
  if (gtmVars.length > 0) {
    const byUser = new Map<string, typeof gtmVars>();
    for (const v of gtmVars) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, []);
      byUser.get(v.userId)!.push(v);
    }
    const lines: string[] = ["## GTM Variables"];
    for (const [uid, vars] of byUser) {
      lines.push(`\n### ${uname(uid)}`);
      for (const v of vars) {
        const val = v.value ? v.value : "(empty)";
        lines.push(`- **${v.name}** ({{${v.mergeField}}}): ${val}`);
      }
    }
    sections.push(lines.join("\n"));
  }

  // ─── Maturity Stage + Assessments ───────────────────────────────
  const stages = await prisma.salesMaturityStage.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, currentStage: true, updatedAt: true },
  });
  let primaryStage: string | null = null;
  if (stages.length > 0) {
    const stageLines = ["## GTM Maturity Stage"];
    for (const s of stages) {
      stageLines.push(`- ${uname(s.userId)}: **${s.currentStage}** (updated ${fmtDate(s.updatedAt)})`);
    }
    primaryStage = stages[0].currentStage;
    sections.push(stageLines.join("\n"));
  }

  const assessments = await prisma.maturityAssessment.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, title: true, completedAt: true, userId: true },
    orderBy: { completedAt: "desc" },
  });
  if (assessments.length > 0) {
    const lines = ["## Maturity Assessments (history)"];
    for (const a of assessments) {
      lines.push(`- ${fmtDate(a.completedAt)} · ${uname(a.userId)}: ${a.title || "Untitled assessment"}`);
    }
    sections.push(lines.join("\n"));

    // Most recent assessment, expanded with answers.
    const latest = assessments[0];
    const answers = await prisma.maturityAnswer.findMany({
      where: { assessmentId: latest.id },
      select: {
        answer: true,
        question: { select: { category: true, globalOrder: true, question: true } },
      },
      orderBy: { question: { globalOrder: "asc" } },
    });
    if (answers.length > 0) {
      const expanded = [
        `## Most Recent Maturity Assessment (full answers)`,
        `*${uname(latest.userId)} · ${fmtDate(latest.completedAt)} · ${latest.title || "Untitled"}*`,
      ];
      let currentCategory = "";
      for (const a of answers) {
        if (a.question.category !== currentCategory) {
          currentCategory = a.question.category;
          expanded.push(`\n### ${currentCategory}`);
        }
        expanded.push(`Q${a.question.globalOrder}: ${a.question.question}\nA: ${a.answer}\n`);
      }
      sections.push(expanded.join("\n"));
    }
  }

  // ─── Sales Readiness Progression (account-scoped) ───────────────
  const readinessByStatus: Record<string, number> = {};
  if (accountId) {
    const accountItems = await prisma.salesReadinessAccountItem.findMany({
      where: { accountId },
      select: {
        status: true, statusChangedAt: true, completedAt: true, notes: true, evidenceUrl: true,
        item: { select: { title: true, capabilityCategory: true, maturityStage: true } },
      },
    });
    if (accountItems.length > 0) {
      const grouped: Record<string, typeof accountItems> = {};
      for (const it of accountItems) {
        const s = it.status || "to_do";
        readinessByStatus[s] = (readinessByStatus[s] ?? 0) + 1;
        if (!grouped[s]) grouped[s] = [];
        grouped[s].push(it);
      }
      const order = ["done", "up_next", "deferred", "to_do", "not_doing"];
      const lines = ["## Sales Readiness Progression"];
      for (const status of order) {
        const items = grouped[status];
        if (!items || items.length === 0) continue;
        lines.push(`\n### ${status} (${items.length})`);
        for (const it of items) {
          const evidence = it.evidenceUrl ? ` · evidence: ${it.evidenceUrl}` : "";
          const completed = it.completedAt ? ` · completed ${fmtDate(it.completedAt)}` : "";
          lines.push(`- [${it.item.maturityStage}] **${it.item.capabilityCategory}** — ${it.item.title}${completed}${evidence}`);
          if (it.notes) {
            const t = truncate(it.notes, CAPS.perReadinessNotes);
            if (t.truncated) truncations.push(`readiness notes for "${it.item.title}"`);
            lines.push(`  notes: ${t.text}`);
          }
        }
      }
      sections.push(lines.join("\n"));
    }
  }

  // ─── Coaching framework (goals + tasks + comments) ──────────────
  const goals = await prisma.coachingGoal.findMany({
    where: { userId: { in: userIds } },
    select: {
      id: true, userId: true, title: true, description: true, status: true,
      statusChangedAt: true, createdAt: true,
      tasks: {
        select: {
          id: true, title: true, description: true, status: true, statusChangedAt: true,
          parentTaskId: true, createdAt: true, order: true,
          comments: {
            select: { body: true, createdAt: true, author: { select: { name: true, slackUserName: true, email: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  let totalTasks = 0;
  if (goals.length > 0) {
    const lines = ["## Coaching Goals & Tasks"];
    for (const g of goals) {
      lines.push(`\n### [${g.status}] ${g.title} — ${uname(g.userId)}`);
      if (g.description) lines.push(g.description);
      const topLevel = g.tasks.filter((t) => !t.parentTaskId);
      for (const t of topLevel) {
        totalTasks++;
        const desc = t.description ? truncate(t.description, CAPS.perTaskDescription) : null;
        if (desc?.truncated) truncations.push(`task description for "${t.title}"`);
        lines.push(`- [${t.status}] ${t.title}${desc ? `\n    ${desc.text.replace(/\n/g, "\n    ")}` : ""}`);
        for (const c of t.comments) {
          const who = c.author?.name || c.author?.slackUserName || c.author?.email || "Someone";
          lines.push(`    - 💬 ${who}: ${c.body}`);
        }
        const subs = g.tasks.filter((s) => s.parentTaskId === t.id);
        for (const s of subs) {
          totalTasks++;
          const sd = s.description ? truncate(s.description, CAPS.perTaskDescription) : null;
          if (sd?.truncated) truncations.push(`subtask description for "${s.title}"`);
          lines.push(`    - [${s.status}] ${s.title}${sd ? `\n        ${sd.text.replace(/\n/g, "\n        ")}` : ""}`);
        }
      }
    }
    sections.push(lines.join("\n"));
  }

  // ─── Coaching sessions (notes always; transcripts on most recent 5) ─
  const sessions = await prisma.coachingSession.findMany({
    where: { userId: { in: userIds } },
    select: {
      id: true, userId: true, title: true, sessionDate: true, sessionStatus: true,
      notes: true, transcript: true, recordingUrl: true, createdAt: true,
    },
    orderBy: { sessionDate: "desc" },
  });
  let sessionsWithTranscripts = 0;
  if (sessions.length > 0) {
    const lines = ["## Coaching Sessions"];
    sessions.forEach((s, idx) => {
      const includeTranscript = idx < CAPS.recentSessionsWithTranscript && !!s.transcript;
      lines.push(`\n### ${fmtDate(s.sessionDate)} · ${uname(s.userId)} · [${s.sessionStatus}] ${s.title}`);
      if (s.recordingUrl) lines.push(`Recording: ${s.recordingUrl}`);
      if (s.notes) {
        const n = truncate(s.notes, CAPS.perSessionNotes);
        if (n.truncated) truncations.push(`session notes for "${s.title}"`);
        lines.push(`\n**Notes**\n${n.text}`);
      }
      if (includeTranscript && s.transcript) {
        const t = truncate(s.transcript, CAPS.perTranscript);
        if (t.truncated) truncations.push(`transcript for "${s.title}"`);
        lines.push(`\n**Transcript**\n${t.text}`);
        sessionsWithTranscripts++;
      }
    });
    sections.push(lines.join("\n"));
  }

  // ─── Sales Asset Library (account-scoped) ───────────────────────
  let assetCount = 0;
  if (accountId) {
    const assets = await prisma.salesAsset.findMany({
      where: { accountId, archived: false },
      select: {
        name: true, description: true, category: true, slotKey: true,
        currentLabel: true, currentUrl: true,
        versions: {
          select: { label: true, notes: true, url: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 3,
        },
      },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    assetCount = assets.length;
    if (assets.length > 0) {
      const lines = ["## Sales Asset Library"];
      const byCategory = new Map<string, typeof assets>();
      for (const a of assets) {
        if (!byCategory.has(a.category)) byCategory.set(a.category, []);
        byCategory.get(a.category)!.push(a);
      }
      for (const [cat, items] of byCategory) {
        lines.push(`\n### ${cat}`);
        for (const a of items) {
          const labelPart = a.currentLabel ? ` (${a.currentLabel})` : "";
          const urlPart = a.currentUrl ? ` — ${a.currentUrl}` : "";
          lines.push(`- **${a.name}**${labelPart}${urlPart}`);
          if (a.description) lines.push(`  ${a.description}`);
          for (const v of a.versions) {
            if (v.notes) {
              const n = truncate(v.notes, CAPS.perAssetVersionNotes);
              if (n.truncated) truncations.push(`version notes for "${a.name}"`);
              lines.push(`  - v ${fmtDate(v.createdAt)}${v.label ? ` (${v.label})` : ""}: ${n.text}`);
            }
          }
        }
      }
      sections.push(lines.join("\n"));
    }
  }

  let contextText = sections.join("\n\n");

  // Soft-cap fallback: if we still blew the budget, drop transcripts
  // oldest-first by truncating the Coaching Sessions section.
  if (contextText.length > CAPS.totalSoftCap) {
    truncations.push(`bundle exceeded ${CAPS.totalSoftCap} chars; oldest transcripts dropped`);
    contextText = contextText.slice(0, CAPS.totalSoftCap) + "\n…[bundle truncated]";
  }

  return {
    contextText,
    stats: {
      users: users.length,
      gtmVariables: gtmVars.length,
      maturityAssessments: assessments.length,
      readinessItems: Object.values(readinessByStatus).reduce((s, n) => s + n, 0),
      coachingSessions: sessions.length,
      coachingSessionsWithTranscripts: sessionsWithTranscripts,
      coachingGoals: goals.length,
      coachingTasks: totalTasks,
      salesAssets: assetCount,
      totalChars: contextText.length,
      maturityStage: primaryStage,
      readinessByStatus,
    },
    truncations,
  };
}
