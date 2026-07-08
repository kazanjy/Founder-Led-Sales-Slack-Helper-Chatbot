import { randomUUID } from "crypto";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { buildSessionContext } from "./synthesize";

/**
 * Implicit goal tracking — the extraction half.
 *
 * Reads a coaching session's notes + transcript (via the SAME context
 * builder the prose synthesis uses, with `[id: …]` markers added) and
 * asks the model for structured verdicts:
 *
 *   - update_task / update_goal — an EXISTING item the session shows
 *     was completed, dropped, or deprioritized
 *   - new_task — a new commitment that belongs under an existing goal
 *     (or under a new goal proposed in the same batch)
 *   - new_goal — a new goal-sized body of work (active queue)
 *   - new_next_goal — work explicitly parked for later (Up Next queue)
 *
 * Every candidate must carry a short VERBATIM evidence quote from the
 * session — no quote, no candidate. Candidates are persisted as a JSON
 * blob on the session row and touch nothing until the founder accepts
 * them through the review panel (see the /outcomes commit endpoint).
 *
 * Re-extraction happens on every save (notes grow during a session).
 * To avoid re-nagging, prior decisions carry forward: a fresh
 * candidate that matches a previously rejected/committed one (same
 * target+status for updates, same normalized title for creations)
 * inherits that status instead of returning to pending. Creations
 * whose title matches an already-existing goal/task are dropped
 * outright.
 */

export type OutcomeCandidateKind =
  | "update_task"
  | "update_goal"
  | "new_task"
  | "new_goal"
  | "new_next_goal";

export type OutcomeCandidateStatus = "pending" | "rejected" | "committed";

export interface OutcomeCandidate {
  id: string;
  kind: OutcomeCandidateKind;
  // update_* — which existing record, and what the session suggests:
  targetId?: string;
  targetTitle?: string;
  newStatus?: "done" | "not_doing" | "deprioritized";
  // Where an update_task's target lives, so the review UI can show
  // context ("under Goal › Parent task"). Goal title for any task;
  // parent-task title only when the target is itself a subtask.
  parentGoalTitle?: string;
  parentTaskTitle?: string;
  // new_* — the proposed record:
  title?: string;
  description?: string;
  /** Parent EXISTING goal for a new_task. */
  goalId?: string;
  goalTitle?: string;
  /** Parent NEW-goal candidate (same batch) for a new_task. */
  parentCandidateId?: string;
  /** Verbatim quote from notes/transcript that justifies this. */
  evidence: string;
  confidence: "high" | "medium" | "low";
  status: OutcomeCandidateStatus;
}

export interface OutcomeCandidatesBlob {
  version: 1;
  extractedAt: string;
  candidates: OutcomeCandidate[];
}

const EXTRACTION_PROMPT = `You are analyzing a founder's sales-coaching session (notes and possibly a transcript) to infer goal/task outcomes. The context below lists the founder's EXISTING goals and tasks, each tagged with [id: …], followed by the session content.

Return ONLY a JSON object with this exact shape:

{
  "completions": [
    { "type": "task" | "goal", "id": "<existing id from the context>", "newStatus": "done" | "not_doing" | "deprioritized", "evidence": "<short VERBATIM quote>", "confidence": "high" | "medium" | "low" }
  ],
  "newTasks": [
    { "title": "...", "description": "... or null", "existingGoalId": "<id of the existing goal it belongs under>", "evidence": "<short VERBATIM quote>", "confidence": "high" | "medium" | "low" }
  ],
  "newGoals": [
    { "title": "...", "description": "... or null", "queue": "active" | "up_next", "tasks": [ { "title": "...", "description": "... or null" } ], "evidence": "<short VERBATIM quote>", "confidence": "high" | "medium" | "low" }
  ]
}

Rules — follow all of them strictly:
- EVIDENCE IS MANDATORY. Every item needs a short verbatim quote (max ~200 chars) copied from the notes or transcript. If you cannot quote it, do not propose it.
- Completions: only mark something done/not_doing/deprioritized when the session shows it HAPPENED or was DECIDED ("we shipped X", "let's drop Y", "park Z until…") — not mere intent or progress. "Working on it" is not done.
- "deprioritized"/"up_next": use when work is explicitly parked for later.
- New tasks: concrete commitments to act ("I'll…", "we agreed to…", "next step is…"). Not discussion topics, not advice given, not decisions/learnings — those belong in the prose synthesis, not here.
- Prefer attaching new tasks under an EXISTING goal (use its id). Only propose a new goal when a genuine new goal-sized body of work emerged that no existing goal covers; cluster its tasks under it.
- DO NOT re-propose anything that already exists in the goal/task listings — check titles before proposing.
- Titles: short, imperative, specific ("Send pricing follow-up to Acme", not "Follow up").
- Be conservative. An empty array is a fine answer. Cap the total across all three arrays at 12 items, favoring high-confidence ones.
- Return ONLY the JSON object, no commentary.`;

interface RawCompletion {
  type?: string;
  id?: string;
  newStatus?: string;
  evidence?: string;
  confidence?: string;
}
interface RawNewTask {
  title?: string;
  description?: string | null;
  existingGoalId?: string;
  evidence?: string;
  confidence?: string;
}
interface RawNewGoal {
  title?: string;
  description?: string | null;
  queue?: string;
  tasks?: Array<{ title?: string; description?: string | null }>;
  evidence?: string;
  confidence?: string;
}

const VALID_STATUSES = new Set(["done", "not_doing", "deprioritized"]);

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normConfidence(c: string | undefined): "high" | "medium" | "low" {
  return c === "high" || c === "low" ? c : "medium";
}

function cleanEvidence(e: string | undefined): string {
  const t = (e || "").trim();
  return t.length > 300 ? t.slice(0, 297) + "…" : t;
}

/**
 * Carry-forward key: identifies "the same suggestion" across
 * re-extractions so a founder's earlier decision sticks.
 */
function candidateKey(c: OutcomeCandidate): string {
  if (c.kind === "update_task" || c.kind === "update_goal") {
    return `${c.kind}:${c.targetId}:${c.newStatus}`;
  }
  return `${c.kind}:${normTitle(c.title || "")}`;
}

/**
 * Run outcome extraction for a session and persist the candidate blob
 * on the session row. Returns the blob, or null when the session
 * doesn't exist or has too little content to be worth a model call
 * (in which case any existing blob is left untouched).
 *
 * Callers should treat failures as non-fatal — extraction riding the
 * post-save job must never block the save or the prose synthesis.
 */
export async function extractSessionOutcomes(
  userId: string,
  sessionId: string
): Promise<OutcomeCandidatesBlob | null> {
  const session = await prisma.coachingSession.findFirst({
    where: { id: sessionId, userId },
    select: {
      id: true,
      notes: true,
      transcript: true,
      outcomeCandidates: true,
    },
  });
  if (!session) return null;

  // Don't burn a model call on an empty draft — "(draft)" notes with
  // no transcript can't contain outcomes.
  const contentLength =
    (session.notes || "").trim().length + (session.transcript || "").trim().length;
  if (contentLength < 200) return null;

  const context = await buildSessionContext(userId, sessionId, { includeIds: true });
  if (!context) return null;

  // Known-record sets for validating the model's id references, and
  // existing titles for dropping duplicate creations.
  const [goals, nextGoals] = await Promise.all([
    prisma.coachingGoal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        status: true,
        tasks: { select: { id: true, title: true, status: true, parentTaskId: true } },
      },
    }),
    prisma.coachingNextGoal.findMany({
      where: { userId },
      select: { id: true, title: true, tasks: { select: { title: true } } },
    }),
  ]);
  const goalIds = new Set(goals.map((g) => g.id));
  const activeGoalIds = new Set(goals.filter((g) => g.status === "active").map((g) => g.id));
  const taskIds = new Set(goals.flatMap((g) => g.tasks.map((t) => t.id)));

  // taskId → { goalTitle, parentTaskId } so an update_task candidate
  // can render its home ("under Goal › Parent task"). Parent-task
  // title is resolved via titleById below.
  const taskParent = new Map<string, { goalTitle: string; parentTaskId: string | null }>();
  for (const g of goals) {
    for (const t of g.tasks) {
      taskParent.set(t.id, { goalTitle: g.title, parentTaskId: t.parentTaskId });
    }
  }
  const existingTitles = new Set<string>();
  for (const g of goals) {
    existingTitles.add(normTitle(g.title));
    for (const t of g.tasks) existingTitles.add(normTitle(t.title));
  }
  for (const g of nextGoals) {
    existingTitles.add(normTitle(g.title));
    for (const t of g.tasks) existingTitles.add(normTitle(t.title));
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${context}` },
    ],
  });

  let parsed: {
    completions?: RawCompletion[];
    newTasks?: RawNewTask[];
    newGoals?: RawNewGoal[];
  };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Outcome extraction returned unparseable JSON");
  }

  const candidates: OutcomeCandidate[] = [];

  // Titles of existing goals/tasks so update candidates can render
  // "mark 'Build outbound sequence' done" without a client-side join.
  const titleById = new Map<string, string>();
  for (const g of goals) {
    titleById.set(g.id, g.title);
    for (const t of g.tasks) titleById.set(t.id, t.title);
  }

  for (const raw of parsed.completions || []) {
    const isTask = raw.type === "task";
    const isGoal = raw.type === "goal";
    const evidence = cleanEvidence(raw.evidence);
    if (!raw.id || !evidence || !raw.newStatus || !VALID_STATUSES.has(raw.newStatus)) continue;
    if (isTask && !taskIds.has(raw.id)) continue;
    if (isGoal && !goalIds.has(raw.id)) continue;
    if (!isTask && !isGoal) continue;
    // For a task, resolve where it lives so the UI can show context.
    const home = isTask ? taskParent.get(raw.id) : undefined;
    const parentTaskTitle =
      home?.parentTaskId ? titleById.get(home.parentTaskId) : undefined;
    candidates.push({
      id: randomUUID(),
      kind: isTask ? "update_task" : "update_goal",
      targetId: raw.id,
      targetTitle: titleById.get(raw.id),
      newStatus: raw.newStatus as OutcomeCandidate["newStatus"],
      parentGoalTitle: home?.goalTitle,
      parentTaskTitle,
      evidence,
      confidence: normConfidence(raw.confidence),
      status: "pending",
    });
  }

  for (const raw of parsed.newTasks || []) {
    const evidence = cleanEvidence(raw.evidence);
    const title = (raw.title || "").trim();
    if (!title || !evidence) continue;
    if (existingTitles.has(normTitle(title))) continue; // already exists
    if (!raw.existingGoalId || !activeGoalIds.has(raw.existingGoalId)) continue;
    candidates.push({
      id: randomUUID(),
      kind: "new_task",
      title,
      description: (raw.description || "").trim() || undefined,
      goalId: raw.existingGoalId,
      goalTitle: titleById.get(raw.existingGoalId),
      evidence,
      confidence: normConfidence(raw.confidence),
      status: "pending",
    });
  }

  for (const raw of parsed.newGoals || []) {
    const evidence = cleanEvidence(raw.evidence);
    const title = (raw.title || "").trim();
    if (!title || !evidence) continue;
    if (existingTitles.has(normTitle(title))) continue;
    const goalCandidate: OutcomeCandidate = {
      id: randomUUID(),
      kind: raw.queue === "up_next" ? "new_next_goal" : "new_goal",
      title,
      description: (raw.description || "").trim() || undefined,
      evidence,
      confidence: normConfidence(raw.confidence),
      status: "pending",
    };
    candidates.push(goalCandidate);
    for (const t of raw.tasks || []) {
      const tTitle = (t.title || "").trim();
      if (!tTitle || existingTitles.has(normTitle(tTitle))) continue;
      candidates.push({
        id: randomUUID(),
        kind: "new_task",
        title: tTitle,
        description: (t.description || "").trim() || undefined,
        parentCandidateId: goalCandidate.id,
        // Nested tasks justify themselves via the parent goal's quote.
        evidence,
        confidence: goalCandidate.confidence,
        status: "pending",
      });
    }
  }

  // Carry forward prior decisions so re-saves don't re-nag: a fresh
  // candidate matching one the founder already rejected (or that was
  // already committed) inherits that status. Pending priors don't
  // carry — the fresh extraction simply replaces them.
  const prior = session.outcomeCandidates as unknown as OutcomeCandidatesBlob | null;
  if (prior?.candidates?.length) {
    const decided = new Map<string, OutcomeCandidateStatus>();
    for (const p of prior.candidates) {
      if (p.status === "rejected" || p.status === "committed") {
        decided.set(candidateKey(p), p.status);
      }
    }
    for (const c of candidates) {
      const carried = decided.get(candidateKey(c));
      if (carried) c.status = carried;
    }
    // A task nested under a decided new-goal candidate follows its parent.
    const byId = new Map(candidates.map((c) => [c.id, c]));
    for (const c of candidates) {
      if (c.parentCandidateId) {
        const parent = byId.get(c.parentCandidateId);
        if (parent && parent.status !== "pending") c.status = parent.status;
      }
    }
  }

  const blob: OutcomeCandidatesBlob = {
    version: 1,
    extractedAt: new Date().toISOString(),
    candidates,
  };

  await prisma.coachingSession.update({
    where: { id: sessionId },
    // Prisma Json column — the blob is plain JSON-serializable data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { outcomeCandidates: blob as any, outcomeCandidatesAt: new Date() },
  });

  return blob;
}
