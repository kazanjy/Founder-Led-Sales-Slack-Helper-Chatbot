import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { gradePrecallPlan, gradeRapport, PrecallAnswers, PracticeScore } from "@/lib/practice/grade";
import { serializePracticeSession } from "@/lib/practice/serialize";
import type { PracticePersona } from "@/lib/practice/persona";

/**
 * POST /api/practice/sessions/[id]/grade { answers }
 *
 * Finalize a drill attempt: grade the answers against the hidden
 * dossier, persist score + answers, flip status to completed. The
 * response is the first time the hidden dossier ships to the client
 * (the reveal). Already-completed sessions return their stored score
 * (idempotent — no re-grading on double-click).
 */

export const maxDuration = 120;

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
    if (session.status === "completed") {
      return NextResponse.json({ session: serializePracticeSession(session) });
    }
    const body = await request.json().catch(() => null);
    const a = body?.answers;
    const persona = session.persona as unknown as PracticePersona;

    let answers: Record<string, unknown>;
    let score: PracticeScore;
    if (session.drill === "precall_plan") {
      if (
        !a ||
        typeof a.orgPersona !== "string" ||
        typeof a.humanPersona !== "string" ||
        typeof a.angle !== "string" ||
        !Array.isArray(a.valuePropsLand)
      ) {
        return NextResponse.json({ error: "answers {orgPersona, humanPersona, angle, valuePropsLand[]} required" }, { status: 400 });
      }
      const precall: PrecallAnswers = {
        orgPersona: a.orgPersona,
        humanPersona: a.humanPersona,
        angle: a.angle,
        valuePropsLand: a.valuePropsLand.filter((v: unknown): v is string => typeof v === "string"),
      };
      answers = precall as unknown as Record<string, unknown>;
      score = await gradePrecallPlan(persona, precall);
    } else if (session.drill === "rapport") {
      if (!a || typeof a.icebreaker !== "string" || !a.icebreaker.trim()) {
        return NextResponse.json({ error: "answers {icebreaker} required" }, { status: 400 });
      }
      answers = { icebreaker: a.icebreaker.trim() };
      score = await gradeRapport(persona, a.icebreaker.trim());
    } else {
      return NextResponse.json({ error: "Grading for this drill isn't available yet" }, { status: 400 });
    }

    const updated = await prisma.practiceSession.update({
      where: { id: session.id },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        answers: answers as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        score: score as any,
        status: "completed",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ session: serializePracticeSession(updated) });
  } catch (err) {
    console.error("[practice grade] failed:", err);
    const message = err instanceof Error ? err.message : "Grading failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
