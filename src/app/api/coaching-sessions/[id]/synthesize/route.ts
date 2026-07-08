import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { synthesizeSession } from "@/lib/coaching/synthesize";
import { extractSessionOutcomes } from "@/lib/coaching/extract-outcomes";

/**
 * POST /api/coaching-sessions/[id]/synthesize
 *
 * The post-save background job. Runs two model passes in parallel
 * over the same session context:
 *
 *   1. Session Synthesis — the prose "what we discussed / agreed /
 *      will do next" rollup (lib/coaching/synthesize.ts)
 *   2. Outcome extraction — structured candidate goal/task updates
 *      inferred from the session (lib/coaching/extract-outcomes.ts)
 *
 * Called by the coaching page right after every save. The two passes
 * are independent — one failing must not sink the other — so they run
 * under allSettled and the response reports each separately. The
 * response is "ok" if the synthesis landed; extraction is best-effort
 * garnish (its results surface via the session's candidate blob, not
 * this response).
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

    // Account-scoped access — match the GET/PUT routes' visibility
    // model so account teammates can synthesize each other's sessions
    // if their access policy already allows it.
    const session = await prisma.coachingSession.findFirst({
      where: user.accountId
        ? { id, user: { accountId: user.accountId } }
        : { id, userId: user.id },
      select: { id: true, userId: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [synthesisResult, outcomesResult] = await Promise.allSettled([
      synthesizeSession(session.userId, session.id),
      extractSessionOutcomes(session.userId, session.id),
    ]);

    if (outcomesResult.status === "rejected") {
      console.error(
        "[coaching-session synthesize] outcome extraction failed:",
        outcomesResult.reason
      );
    }

    if (synthesisResult.status === "rejected" || !synthesisResult.value) {
      if (synthesisResult.status === "rejected") {
        console.error(
          "[coaching-session synthesize] synthesis failed:",
          synthesisResult.reason
        );
      }
      return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
    }

    const result = synthesisResult.value;
    return NextResponse.json({
      synthesis: result.synthesis,
      synthesisAt: result.synthesisAt.toISOString(),
      outcomeCandidates:
        outcomesResult.status === "fulfilled" ? outcomesResult.value : null,
    });
  } catch (err) {
    console.error(`[coaching-session synthesize] failed:`, err);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
