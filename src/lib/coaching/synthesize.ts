import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { TAKEAWAYS_SYNTHESIS_PROMPT } from "./synthesis-prompt";

export { TAKEAWAYS_SYNTHESIS_PROMPT };

/**
 * Pull the session + everything the synthesis prompt benefits from
 * seeing — notes, transcript, attached goals/tasks, metric entries,
 * the user's current active goals and Up Next queue, and the
 * current maturity stage. Mirrors what buildEnrichedChatContext
 * assembles on the client for the manual "Synthesize Takeaways"
 * button so both surfaces feed the model the same context.
 */
async function buildSessionContext(
  userId: string,
  sessionId: string
): Promise<string | null> {
  const session = await prisma.coachingSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      goals: {
        orderBy: { order: "asc" },
        include: {
          tasks: { orderBy: { order: "asc" } },
        },
      },
      metricEntries: {
        include: { metricDefinition: true },
        orderBy: { metricDefinition: { order: "asc" } },
      },
    },
  });
  if (!session) return null;

  // Pull live coaching state alongside the session-scoped data so the
  // model sees both the session's own outcomes AND the broader open
  // work the founder is carrying forward.
  const [stageRow, activeGoals, nextGoals] = await Promise.all([
    prisma.salesMaturityStage.findUnique({
      where: { userId },
      select: { currentStage: true },
    }),
    prisma.coachingGoal.findMany({
      where: { userId, status: "active" },
      orderBy: { order: "asc" },
      include: {
        tasks: { orderBy: { order: "asc" } },
      },
    }),
    prisma.coachingNextGoal.findMany({
      where: { userId },
      orderBy: { order: "asc" },
      include: { tasks: { orderBy: { order: "asc" } } },
    }),
  ]);

  const formatDate = (d: Date) => d.toISOString().slice(0, 10);
  let ctx = `## Coaching Session — ${session.title}\n\n`;
  ctx += `**Date:** ${formatDate(session.sessionDate)}\n`;
  ctx += `**Status:** ${session.sessionStatus}\n\n`;

  if (stageRow?.currentStage) {
    ctx += `**Current Sales Maturity Stage:** ${stageRow.currentStage}\n\n`;
  }

  if (session.notes && session.notes.trim()) {
    ctx += `### Notes\n\n${session.notes}\n\n`;
  }
  if (session.transcript && session.transcript.trim()) {
    ctx += `### Transcript\n\n${session.transcript}\n\n`;
  }

  if (session.metricEntries.length > 0) {
    ctx += `### Metrics captured this session\n\n`;
    for (const m of session.metricEntries) {
      ctx += `- **${m.metricDefinition.name}:** ${m.currentValue}\n`;
    }
    ctx += `\n`;
  }

  if (session.goals.length > 0) {
    ctx += `### Goals + Tasks created in this session\n\n`;
    for (const g of session.goals) {
      ctx += `**${g.title}** [${g.status}]\n`;
      if (g.description) ctx += `${g.description}\n`;
      for (const t of g.tasks) {
        const check = t.status === "done" ? "x" : " ";
        ctx += `- [${check}] ${t.title}`;
        if (t.status === "not_doing") ctx += ` ~~(not doing)~~`;
        if (t.status === "deprioritized") ctx += ` *(deprioritized)*`;
        ctx += `\n`;
        if (t.description) ctx += `  ${t.description}\n`;
      }
      ctx += `\n`;
    }
  }

  if (activeGoals.length > 0) {
    ctx += `---\n\n### Active goals across all sessions (carry-forward state)\n\n`;
    for (const g of activeGoals) {
      ctx += `**${g.title}** [${g.status}]\n`;
      if (g.description) ctx += `${g.description}\n`;
      for (const t of g.tasks) {
        const check = t.status === "done" ? "x" : " ";
        ctx += `- [${check}] ${t.title}\n`;
      }
      ctx += `\n`;
    }
  }

  if (nextGoals.length > 0) {
    ctx += `---\n\n### Up Next (queued for after priorities land)\n\n`;
    for (const g of nextGoals) {
      ctx += `**${g.title}**\n`;
      if (g.description) ctx += `${g.description}\n`;
      for (const t of g.tasks) {
        ctx += `- ${t.title}\n`;
      }
      ctx += `\n`;
    }
  }

  return ctx;
}

/**
 * Generate and persist a fresh session synthesis for the given
 * coaching session. Idempotent — every call regenerates because the
 * inputs (notes, transcript, goals) may have changed. Updates
 * `synthesis` + `synthesisAt` on the session row.
 *
 * Throws when the session doesn't exist or when the OpenAI call
 * fails. Callers (typically the on-save background job) should
 * catch + log and not let synthesis failures block the save itself.
 */
export async function synthesizeSession(
  userId: string,
  sessionId: string
): Promise<{ synthesis: string; synthesisAt: Date } | null> {
  const context = await buildSessionContext(userId, sessionId);
  if (!context) return null;

  const userMessage = `${TAKEAWAYS_SYNTHESIS_PROMPT}\n\n---\n\n${context}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [
      { role: "user", content: userMessage },
    ],
  });

  const synthesis = (completion.choices[0]?.message?.content || "").trim();
  if (!synthesis) {
    throw new Error("Empty synthesis returned from model");
  }

  const synthesisAt = new Date();
  await prisma.coachingSession.update({
    where: { id: sessionId },
    data: { synthesis, synthesisAt },
  });

  return { synthesis, synthesisAt };
}
