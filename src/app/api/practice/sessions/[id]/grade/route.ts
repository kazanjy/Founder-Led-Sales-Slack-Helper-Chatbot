import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { gradePrecallPlan, gradeRapport, gradeAgendaSet, gradeDiscovery, PrecallAnswers, PracticeScore } from "@/lib/practice/grade";
import { loadDiscoveryFramework } from "@/lib/discovery-framework";
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
      // The exchange lives in turns (icebreaker + persona reply from
      // the /turn endpoint); the grade call carries only the pivot.
      const turns = (session.turns as Array<{ role: string; text: string }> | null) || [];
      const icebreaker = turns.find((t) => t.role === "user")?.text;
      const personaReply = turns.find((t) => t.role === "persona")?.text;
      if (!icebreaker || !personaReply) {
        return NextResponse.json({ error: "Deliver your icebreaker first — the buyer needs to respond before you pivot" }, { status: 400 });
      }
      if (!a || typeof a.pivot !== "string" || !a.pivot.trim()) {
        return NextResponse.json({ error: "answers {pivot} required" }, { status: 400 });
      }
      answers = { icebreaker, personaReply, pivot: a.pivot.trim() };
      score = await gradeRapport(persona, {
        icebreaker,
        personaReply,
        pivot: a.pivot.trim(),
      });
    } else if (session.drill === "agenda") {
      if (!a || typeof a.transcript !== "string" || !a.transcript.trim()) {
        return NextResponse.json({ error: "answers {transcript} required" }, { status: 400 });
      }
      const mode = a.mode === "script_hidden" ? "script_hidden" : "script_visible";
      const durationMs = typeof a.durationMs === "number" && a.durationMs > 0 ? a.durationMs : null;
      // The script graded against is the one the founder approved in
      // the UI (session-local edits allowed) — falling back to the
      // scenario's snapshot. Client sends it back so edits count.
      const script =
        typeof a.script === "string" && a.script.trim()
          ? a.script.trim()
          : persona.script || "";
      if (!script) {
        return NextResponse.json({ error: "No script on this session" }, { status: 400 });
      }
      answers = { transcript: a.transcript.trim(), durationMs, mode, script };
      score = await gradeAgendaSet({
        script,
        transcript: a.transcript.trim(),
        durationMs,
        mode,
      });
    } else if (session.drill === "discovery") {
      const turns = (session.turns as Array<{ role: string; text: string }> | null) || [];
      if (!turns.some((t) => t.role === "user")) {
        return NextResponse.json({ error: "Ask at least one discovery question before grading" }, { status: 400 });
      }
      const mode = a?.mode === "freestyle" ? "freestyle" : "two_level";
      const questionsVisible = a?.questionsVisible === true;
      const framework = await loadDiscoveryFramework(session.userId);
      answers = { mode, questionsVisible };
      score = await gradeDiscovery(persona, turns, {
        mode,
        questionsVisible,
        frameworkListing: framework.questionsListing,
      });
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
