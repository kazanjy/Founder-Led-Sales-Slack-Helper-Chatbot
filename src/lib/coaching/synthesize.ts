import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { TAKEAWAYS_SYNTHESIS_PROMPT } from "./synthesis-prompt";

export { TAKEAWAYS_SYNTHESIS_PROMPT };

/**
 * Pull the seller's positioning (sales narrative + value prop) so
 * the model can render the synthesis in the founder's voice and
 * recognize their terminology. Same shape as loadSellerContext in
 * the agent surfaces — keeps the narrative-default-on invariant
 * consistent across every model call that touches a founder's
 * content.
 */
async function loadSellerContext(userId: string): Promise<{
  narrative: string;
  valueProp100w: string;
}> {
  const [narrativeRow, vp100Row] = await Promise.all([
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_100W" },
      select: { value: true },
    }),
  ]);
  return {
    narrative: (narrativeRow?.value || "").trim(),
    valueProp100w: (vp100Row?.value || "").trim(),
  };
}

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

  const seller = await loadSellerContext(userId);

  const formatDate = (d: Date) => d.toISOString().slice(0, 10);
  let ctx = "";

  // Lead with the seller's positioning so the model interprets the
  // session content through the founder's lens (their value prop,
  // their narrative, their terminology). Without this, takeaways
  // read as generic coach-speak.
  if (seller.narrative || seller.valueProp100w) {
    ctx += `## Seller Context\n\n_The founder's own positioning. Use this to ground voice, terminology, and what's important to them — then synthesize the session below in this lens._\n\n`;
    if (seller.valueProp100w) {
      ctx += `### Value prop (100w)\n${seller.valueProp100w}\n\n`;
    }
    if (seller.narrative) {
      ctx += `### Sales narrative\n${seller.narrative}\n\n`;
    }
    ctx += `---\n\n`;
  }

  ctx += `## Coaching Session — ${session.title}\n\n`;
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
