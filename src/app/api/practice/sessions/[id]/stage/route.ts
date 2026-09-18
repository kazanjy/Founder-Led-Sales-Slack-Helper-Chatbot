import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { serializePracticeSession } from "@/lib/practice/serialize";

/**
 * POST /api/practice/sessions/[id]/stage { stage, answers }
 *
 * Full Call orchestration: persist one stage's answers and advance
 * the stage pointer — WITHOUT grading (the whole call grades at the
 * end, like a real call). Stage progress lives in the session's
 * answers Json:
 *   { stage: "precall"|"rapport"|"agenda"|"discovery"|"wrap",
 *     precall?: {...}, rapport?: { pivot }, agenda?: { transcript, durationMs, mode } }
 * Refresh-safe: the client derives its stepper position from here.
 */

const STAGE_ORDER = ["precall", "rapport", "agenda", "discovery", "wrap"] as const;
type Stage = (typeof STAGE_ORDER)[number];

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
    const session = await prisma.practiceSession.findFirst({
      where: { id, userId: user.id },
    });
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (session.drill !== "full_call") {
      return NextResponse.json({ error: "Stages only apply to Full Call sessions" }, { status: 400 });
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session already completed" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const stage = body?.stage as Stage | undefined;
    if (!stage || !STAGE_ORDER.includes(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }
    const stageAnswers =
      body?.answers && typeof body.answers === "object" ? body.answers : {};

    const existing = (session.answers as Record<string, unknown> | null) || {};
    const nextStage = STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(stage) + 1, STAGE_ORDER.length - 1)];
    const updatedAnswers = {
      ...existing,
      [stage]: stageAnswers,
      stage: nextStage,
    };

    const updated = await prisma.practiceSession.update({
      where: { id: session.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { answers: updatedAnswers as any },
    });
    return NextResponse.json({ session: serializePracticeSession(updated) });
  } catch (err) {
    console.error("[practice stage] failed:", err);
    return NextResponse.json({ error: "Failed to save stage" }, { status: 500 });
  }
}
