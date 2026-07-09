import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generatePersonaReply } from "@/lib/practice/roleplay";
import { serializePracticeSession } from "@/lib/practice/serialize";
import type { PracticePersona } from "@/lib/practice/persona";

/**
 * POST /api/practice/sessions/[id]/turn { text }
 *
 * Roleplay turn: the founder speaks, the persona replies in
 * character. For the rapport drill this is the single
 * icebreaker → response exchange (turns must be empty); the
 * discovery drill will generalize this to a full loop in Phase 4.
 */

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
    if (session.drill !== "rapport") {
      return NextResponse.json({ error: "Turns aren't available for this drill yet" }, { status: 400 });
    }
    const existingTurns = (session.turns as Array<{ role: string; text: string }> | null) || [];
    if (existingTurns.length > 0) {
      return NextResponse.json({ error: "The exchange already happened — submit your pivot for grading" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const persona = session.persona as unknown as PracticePersona;
    const reply = await generatePersonaReply(persona, "rapport_icebreaker", text);

    const turns = [
      { role: "user", text, at: new Date().toISOString() },
      { role: "persona", text: reply, at: new Date().toISOString() },
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
