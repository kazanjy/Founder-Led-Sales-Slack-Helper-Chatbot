import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { synthesizePersona } from "@/lib/practice/persona";
import { serializePracticeSession } from "@/lib/practice/serialize";

/**
 * POST /api/practice/sessions { drill, mode? }
 *   Create a drill session: synthesize a persona from the founder's
 *   playbook, snapshot it, return the session (hidden dossier
 *   stripped — see serialize.ts).
 *
 * GET /api/practice/sessions?drill=…&limit=…
 *   History, newest first.
 */

export const maxDuration = 120;

const VALID_DRILLS = new Set(["precall_plan", "rapport", "agenda", "discovery"]);
// Phase 1 ships the pre-call drill only; the others 400 until their
// phases land so the UI's coming-soon cards can't create orphans.
const LIVE_DRILLS = new Set(["precall_plan"]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const drill = body?.drill;
    if (typeof drill !== "string" || !VALID_DRILLS.has(drill)) {
      return NextResponse.json({ error: "Invalid drill" }, { status: 400 });
    }
    if (!LIVE_DRILLS.has(drill)) {
      return NextResponse.json({ error: "This drill isn't available yet" }, { status: 400 });
    }

    const persona = await synthesizePersona(user.id);
    const session = await prisma.practiceSession.create({
      data: {
        userId: user.id,
        drill,
        mode: typeof body?.mode === "string" ? body.mode : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persona: persona as any,
      },
    });
    return NextResponse.json({ session: serializePracticeSession(session) });
  } catch (err) {
    console.error("[practice sessions] POST failed:", err);
    const message = err instanceof Error ? err.message : "Failed to start drill";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const drill = params.get("drill");
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 100);

    const sessions = await prisma.practiceSession.findMany({
      where: { userId: user.id, ...(drill ? { drill } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({
      sessions: sessions.map(serializePracticeSession),
    });
  } catch (err) {
    console.error("[practice sessions] GET failed:", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}
