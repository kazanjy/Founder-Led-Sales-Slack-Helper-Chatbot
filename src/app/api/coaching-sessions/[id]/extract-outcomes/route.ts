import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { extractSessionOutcomes } from "@/lib/coaching/extract-outcomes";

/**
 * POST /api/coaching-sessions/[id]/extract-outcomes
 *
 * The "Doublecheck Tasks" CTA — re-runs ONLY the outcome-extraction
 * pass (no prose re-synthesis) over the session's notes + transcript
 * against the CURRENT goal/task state. Useful after the founder has
 * worked the list for a while: catches completions the first pass
 * couldn't see yet, retires proposals whose work landed elsewhere,
 * and picks up commitments that were missed.
 *
 * extractSessionOutcomes already carries prior decisions forward
 * (rejected/committed candidates stay resolved; creations matching
 * now-existing records are dropped), so a re-run never re-nags.
 * Account-scoped access mirrors the synthesize route — a coach can
 * run it on a founder's session.
 */

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;

    const session = await prisma.coachingSession.findFirst({
      where: user.accountId
        ? { id, user: { accountId: user.accountId } }
        : { id, userId: user.id },
      select: { id: true, userId: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const blob = await extractSessionOutcomes(session.userId, session.id);
    const pending = blob?.candidates.filter((c) => c.status === "pending").length ?? 0;

    return NextResponse.json({
      outcomeCandidates: blob,
      pending,
    });
  } catch (err) {
    console.error("[coaching-session extract-outcomes] failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Doublecheck failed", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
