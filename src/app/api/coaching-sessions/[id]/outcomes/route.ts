import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type {
  OutcomeCandidate,
  OutcomeCandidatesBlob,
} from "@/lib/coaching/extract-outcomes";

/**
 * POST /api/coaching-sessions/[id]/outcomes
 *
 * Commit the founder's review decisions over a session's extracted
 * outcome candidates. Body:
 *
 *   { decisions: [{ candidateId, action: "accept" | "reject",
 *                   title?, description?, goalId? }] }
 *
 * Accepted candidates are applied in ONE transaction:
 *   - update_task / update_goal → status change (+statusChangedAt)
 *   - new_goal → CoachingGoal born in THIS session
 *   - new_next_goal → CoachingNextGoal (Up Next queue)
 *   - new_task → CoachingTask under its goal — an existing goal
 *     (candidate.goalId, overridable via decision.goalId), or a goal
 *     created from a sibling candidate in this same commit
 *     (parentCandidateId)
 *
 * `title`/`description`/`goalId` on a decision override the
 * candidate's extracted values — the review panel lets the founder
 * edit before accepting. Created records belong to the SESSION OWNER
 * (goals/tasks are founder-scoped), while access follows the same
 * account-scoped visibility as the rest of the coaching routes so a
 * coach can run the review.
 *
 * The blob is then updated in place (accepted → "committed",
 * rejected → "rejected") and outcomesReviewedAt is stamped. Partial
 * reviews are fine — undecided candidates stay pending.
 */

interface Decision {
  candidateId: string;
  action: "accept" | "reject";
  title?: string;
  description?: string;
  goalId?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const decisions: Decision[] = Array.isArray(body?.decisions) ? body.decisions : [];
    if (decisions.length === 0) {
      return NextResponse.json({ error: "decisions array is required" }, { status: 400 });
    }

    const session = await prisma.coachingSession.findFirst({
      where: user.accountId
        ? { id, user: { accountId: user.accountId } }
        : { id, userId: user.id },
      select: { id: true, userId: true, outcomeCandidates: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const blob = session.outcomeCandidates as unknown as OutcomeCandidatesBlob | null;
    if (!blob?.candidates?.length) {
      return NextResponse.json({ error: "No outcome candidates on this session" }, { status: 400 });
    }

    const byId = new Map(blob.candidates.map((c) => [c.id, c]));
    const decisionById = new Map<string, Decision>();
    for (const d of decisions) {
      const candidate = d.candidateId ? byId.get(d.candidateId) : undefined;
      if (!candidate) {
        return NextResponse.json(
          { error: `Unknown candidateId: ${d.candidateId}` },
          { status: 400 }
        );
      }
      if (candidate.status === "committed") {
        // Already applied in a prior pass — ignore rather than double-apply.
        continue;
      }
      if (d.action !== "accept" && d.action !== "reject") {
        return NextResponse.json(
          { error: `Invalid action for ${d.candidateId}` },
          { status: 400 }
        );
      }
      decisionById.set(d.candidateId, d);
    }

    const ownerId = session.userId;
    const skipped: Array<{ candidateId: string; reason: string }> = [];

    await prisma.$transaction(async (tx) => {
      const accepted = (c: OutcomeCandidate) =>
        decisionById.get(c.id)?.action === "accept";

      // Pass 1 — goals, so tasks nested under new-goal candidates have
      // a real parent to land in. candidateId → created record id.
      const createdGoalIds = new Map<string, string>();
      const createdNextGoalIds = new Map<string, string>();

      let goalOrder =
        ((await tx.coachingGoal.aggregate({
          where: { userId: ownerId },
          _max: { order: true },
        }))._max.order ?? -1) + 1;
      let nextGoalOrder =
        ((await tx.coachingNextGoal.aggregate({
          where: { userId: ownerId },
          _max: { order: true },
        }))._max.order ?? -1) + 1;

      for (const c of blob.candidates) {
        if (!accepted(c)) continue;
        const d = decisionById.get(c.id)!;
        const title = (d.title || c.title || "").trim();
        const description = (d.description ?? c.description)?.trim() || null;

        if (c.kind === "new_goal") {
          if (!title) { skipped.push({ candidateId: c.id, reason: "empty title" }); continue; }
          const goal = await tx.coachingGoal.create({
            data: {
              userId: ownerId,
              sessionId: session.id,
              title,
              description,
              order: goalOrder++,
            },
          });
          createdGoalIds.set(c.id, goal.id);
        } else if (c.kind === "new_next_goal") {
          if (!title) { skipped.push({ candidateId: c.id, reason: "empty title" }); continue; }
          const goal = await tx.coachingNextGoal.create({
            data: {
              userId: ownerId,
              title,
              description,
              order: nextGoalOrder++,
            },
          });
          createdNextGoalIds.set(c.id, goal.id);
        }
      }

      // Pass 2 — tasks and status updates.
      for (const c of blob.candidates) {
        if (!accepted(c)) continue;
        const d = decisionById.get(c.id)!;

        if (c.kind === "update_task" || c.kind === "update_goal") {
          if (!c.targetId || !c.newStatus) {
            skipped.push({ candidateId: c.id, reason: "missing target/status" });
            continue;
          }
          const data = { status: c.newStatus, statusChangedAt: new Date() };
          // updateMany + owner filter: no-throw if the record was
          // deleted since extraction, and never crosses user scope.
          const res =
            c.kind === "update_task"
              ? await tx.coachingTask.updateMany({
                  where: { id: c.targetId, userId: ownerId },
                  data,
                })
              : await tx.coachingGoal.updateMany({
                  where: { id: c.targetId, userId: ownerId },
                  data,
                });
          if (res.count === 0) {
            skipped.push({ candidateId: c.id, reason: "target no longer exists" });
          }
        } else if (c.kind === "new_task") {
          const title = (d.title || c.title || "").trim();
          const description = (d.description ?? c.description)?.trim() || null;
          if (!title) { skipped.push({ candidateId: c.id, reason: "empty title" }); continue; }

          // Resolve the parent: explicit override → extracted existing
          // goal → goal created from the sibling candidate this commit.
          const explicitGoalId = d.goalId || c.goalId;
          const parentNewGoalId = c.parentCandidateId
            ? createdGoalIds.get(c.parentCandidateId)
            : undefined;
          const parentNewNextGoalId = c.parentCandidateId
            ? createdNextGoalIds.get(c.parentCandidateId)
            : undefined;

          if (explicitGoalId) {
            const parent = await tx.coachingGoal.findFirst({
              where: { id: explicitGoalId, userId: ownerId },
              select: { id: true },
            });
            if (!parent) {
              skipped.push({ candidateId: c.id, reason: "parent goal not found" });
              continue;
            }
            const maxOrder = await tx.coachingTask.aggregate({
              where: { goalId: parent.id },
              _max: { order: true },
            });
            await tx.coachingTask.create({
              data: {
                userId: ownerId,
                goalId: parent.id,
                title,
                description,
                order: (maxOrder._max.order ?? -1) + 1,
              },
            });
          } else if (parentNewGoalId) {
            const maxOrder = await tx.coachingTask.aggregate({
              where: { goalId: parentNewGoalId },
              _max: { order: true },
            });
            await tx.coachingTask.create({
              data: {
                userId: ownerId,
                goalId: parentNewGoalId,
                title,
                description,
                order: (maxOrder._max.order ?? -1) + 1,
              },
            });
          } else if (parentNewNextGoalId) {
            const maxOrder = await tx.coachingNextTask.aggregate({
              where: { goalId: parentNewNextGoalId },
              _max: { order: true },
            });
            await tx.coachingNextTask.create({
              data: {
                userId: ownerId,
                goalId: parentNewNextGoalId,
                title,
                description,
                order: (maxOrder._max.order ?? -1) + 1,
              },
            });
          } else {
            // Parent candidate wasn't accepted (or was skipped) and no
            // existing goal was chosen — nowhere sensible to land it.
            skipped.push({ candidateId: c.id, reason: "parent goal not accepted" });
          }
        }
      }

      // Fold decisions back into the blob. Skipped accepts revert to
      // pending so they resurface instead of silently vanishing.
      const skippedIds = new Set(skipped.map((s) => s.candidateId));
      const updatedCandidates = blob.candidates.map((c) => {
        const d = decisionById.get(c.id);
        if (!d) return c;
        if (d.action === "reject") return { ...c, status: "rejected" as const };
        if (skippedIds.has(c.id)) return c;
        return {
          ...c,
          status: "committed" as const,
          ...(d.title ? { title: d.title.trim() } : {}),
          ...(d.description !== undefined ? { description: d.description.trim() || undefined } : {}),
          ...(d.goalId ? { goalId: d.goalId } : {}),
        };
      });

      await tx.coachingSession.update({
        where: { id: session.id },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outcomeCandidates: { ...blob, candidates: updatedCandidates } as any,
          outcomesReviewedAt: new Date(),
        },
      });
    });

    const fresh = await prisma.coachingSession.findUnique({
      where: { id: session.id },
      select: { outcomeCandidates: true, outcomesReviewedAt: true },
    });

    return NextResponse.json({
      outcomeCandidates: fresh?.outcomeCandidates ?? null,
      outcomesReviewedAt: fresh?.outcomesReviewedAt?.toISOString() ?? null,
      skipped,
    });
  } catch (err) {
    console.error("[coaching-session outcomes] commit failed:", err);
    return NextResponse.json({ error: "Failed to commit outcomes" }, { status: 500 });
  }
}
