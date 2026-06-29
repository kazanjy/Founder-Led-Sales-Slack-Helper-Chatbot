import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { synthesizeSession } from "@/lib/coaching/synthesize";

/**
 * POST /api/coaching-sessions/[id]/synthesize
 *
 * Regenerate and persist the Session Synthesis for a coaching
 * session. Called by the coaching page right after every save so the
 * "Session Synthesis" panel below the notes always reflects the
 * latest content. Same prompt as the manual "🧪 Synthesize
 * Takeaways" CTA — see lib/coaching/synthesize.ts.
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

    const result = await synthesizeSession(session.userId, session.id);
    if (!result) {
      return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
    }
    return NextResponse.json({
      synthesis: result.synthesis,
      synthesisAt: result.synthesisAt.toISOString(),
    });
  } catch (err) {
    console.error(`[coaching-session synthesize] failed:`, err);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
