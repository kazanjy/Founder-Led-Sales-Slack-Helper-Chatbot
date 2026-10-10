import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { synthesizePersona, PracticePersona } from "@/lib/practice/persona";
import { getAgendaScript } from "@/lib/practice/agenda";
import { buildLiveFirePersona } from "@/lib/practice/livefire";
import { serializePracticeSession } from "@/lib/practice/serialize";

/**
 * POST /api/practice/sessions { drill, mode?, dealId?, meetingEntryId?, rematchSessionId? }
 *   Create a drill session. Persona source, in priority order:
 *   - rematchSessionId → copy the persona snapshot from a prior
 *     session (re-drill the same buyer);
 *   - dealId (+ optional meetingEntryId) → Live-Fire: build the
 *     persona from the REAL deal's evidence;
 *   - otherwise → synthesize a fresh gym buyer from the playbook.
 *   Hidden dossier stripped from the response — see serialize.ts.
 *
 * GET /api/practice/sessions?drill=…&limit=…
 *   History, newest first.
 */

export const maxDuration = 120;

const VALID_DRILLS = new Set(["precall_plan", "rapport", "agenda", "discovery", "full_call"]);
// Drills go live phase by phase; the rest 400 until their phases land
// so the UI's coming-soon cards can't create orphans.
const LIVE_DRILLS = new Set(["precall_plan", "rapport", "agenda", "discovery", "full_call"]);

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

    const rematchSessionId =
      typeof body?.rematchSessionId === "string" ? body.rematchSessionId : null;
    const dealId = typeof body?.dealId === "string" ? body.dealId : null;
    const meetingEntryId =
      typeof body?.meetingEntryId === "string" ? body.meetingEntryId : null;

    let persona: PracticePersona;
    let sessionDealId: string | null = dealId;
    let sessionMeetingEntryId: string | null = meetingEntryId;

    if (rematchSessionId) {
      // Rematch: same buyer, fresh attempt. Persona snapshot (incl.
      // any agenda script) copies verbatim; live-fire anchoring rides
      // along so a rematched real-call rehearsal stays deal-linked.
      const prior = await prisma.practiceSession.findFirst({
        where: { id: rematchSessionId, userId: user.id },
        select: { persona: true, drill: true, dealId: true, meetingEntryId: true },
      });
      if (!prior) {
        return NextResponse.json({ error: "Session to rematch not found" }, { status: 404 });
      }
      if (prior.drill !== drill) {
        return NextResponse.json({ error: "Rematch must use the same drill" }, { status: 400 });
      }
      persona = prior.persona as unknown as PracticePersona;
      sessionDealId = prior.dealId;
      sessionMeetingEntryId = prior.meetingEntryId;
    } else if (dealId) {
      // Live-Fire: real deal, real attendee, evidence-grounded card.
      persona = await buildLiveFirePersona(user.id, dealId, meetingEntryId, drill);
    } else {
      persona = await synthesizePersona(user.id);
      // Agenda drill scenarios carry the script to practice against —
      // saved default > generated from checklist > generic skeleton.
      if (drill === "agenda" || drill === "full_call") {
        const { script, source } = await getAgendaScript(user.id, persona.public);
        persona.script = script;
        persona.scriptSource = source;
      }
    }

    const session = await prisma.practiceSession.create({
      data: {
        userId: user.id,
        drill,
        mode: typeof body?.mode === "string" ? body.mode : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persona: persona as any,
        dealId: sessionDealId,
        meetingEntryId: sessionMeetingEntryId,
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
