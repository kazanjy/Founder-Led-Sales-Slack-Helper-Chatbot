import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generatePersonaReply, generateDiscoveryReply } from "@/lib/practice/roleplay";
import { serializePracticeSession } from "@/lib/practice/serialize";
import type { PracticePersona } from "@/lib/practice/persona";

/**
 * POST /api/practice/sessions/[id]/turn { text }
 *
 * Roleplay turn: the founder speaks, the persona replies in
 * character. Rapport = the single icebreaker → response exchange
 * (turns must be empty). Discovery = a full loop — turns accumulate
 * until the founder grades (two-level caps at 2 founder turns
 * client-side; a server backstop caps runaway conversations).
 */

const DISCOVERY_MAX_TURNS = 60; // backstop, ~30 exchanges

export const maxDuration = 60;

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
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session already completed" }, { status: 400 });
    }
    if (
      session.drill !== "rapport" &&
      session.drill !== "discovery" &&
      session.drill !== "full_call"
    ) {
      return NextResponse.json({ error: "Turns aren't available for this drill yet" }, { status: 400 });
    }
    const existingTurns =
      (session.turns as Array<{ role: string; text: string; stage?: string }> | null) || [];
    if (session.drill === "rapport" && existingTurns.length > 0) {
      return NextResponse.json({ error: "The exchange already happened — submit your pivot for grading" }, { status: 400 });
    }
    if (existingTurns.length >= DISCOVERY_MAX_TURNS) {
      return NextResponse.json({ error: "That's plenty — wrap up and grade" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    // Full Call tags each turn with its stage so the graders can split
    // the transcript ("rapport" exchange vs "discovery" loop).
    const stage =
      session.drill === "full_call" && typeof body?.stage === "string"
        ? body.stage
        : undefined;
    if (session.drill === "full_call" && stage !== "rapport" && stage !== "discovery") {
      return NextResponse.json({ error: "Full Call turns need stage: rapport | discovery" }, { status: 400 });
    }
    if (
      session.drill === "full_call" &&
      stage === "rapport" &&
      existingTurns.some((t) => t.stage === "rapport")
    ) {
      return NextResponse.json({ error: "The rapport exchange already happened" }, { status: 400 });
    }

    const persona = session.persona as unknown as PracticePersona;
    const isRapportTurn =
      session.drill === "rapport" || (session.drill === "full_call" && stage === "rapport");
    const reply = isRapportTurn
      ? await generatePersonaReply(persona, "rapport_icebreaker", text)
      : await generateDiscoveryReply(persona, existingTurns, text);

    const now = new Date().toISOString();
    const turns = [
      ...existingTurns,
      { role: "user", text, at: now, ...(stage ? { stage } : {}) },
      { role: "persona", text: reply, at: now, ...(stage ? { stage } : {}) },
    ];
    const updated = await prisma.practiceSession.update({
      where: { id: session.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { turns: turns as any },
    });
    return NextResponse.json({ session: serializePracticeSession(updated) });
  } catch (err) {
    console.error("[practice turn] failed:", err);
    const message = err instanceof Error ? err.message : "Turn failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
