import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { RAPPORT_PHILOSOPHY } from "@/lib/practice/grade";
import type { PracticePersona } from "@/lib/practice/persona";

/**
 * POST /api/practice/sessions/[id]/hint
 *
 * Generate an example attempt the founder can literally read into the
 * recorder — training wheels for the drill. Rapport only for now.
 * The hint is built from the PUBLIC card (same information the
 * founder has), so it teaches technique without leaking the hidden
 * dossier.
 */

export const maxDuration = 60;

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
    const session = await prisma.practiceSession.findFirst({
      where: { id, userId: user.id },
      select: { id: true, drill: true, status: true, persona: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (session.drill !== "rapport") {
      return NextResponse.json({ error: "Hints aren't available for this drill yet" }, { status: 400 });
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session already completed" }, { status: 400 });
    }

    const persona = session.persona as unknown as PracticePersona;
    const completion = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "user",
          content: `Write ONE example icebreaker a founder could open a sales call with, for the buyer below. It should exemplify this philosophy:

${RAPPORT_PHILOSOPHY}

Rules:
- Use ONLY the public card below (that's all the founder can see).
- Pick a PERSONAL thread from the breadcrumbs — hobby, humor, life detail — not a business one.
- 1-3 sentences, under 50 words, first person, spoken-out-loud natural (it will be READ INTO A RECORDER verbatim). Contractions welcome, corporate polish not.
- Warm, light, ideally lands a small laugh. END WITH AN EASY, OPEN QUESTION — the buyer responds next, so no handoff/pivot; that comes after their reply.
- Return ONLY the icebreaker text, no quotes, no commentary.

BUYER'S PUBLIC CARD:
${JSON.stringify(persona.public, null, 2)}`,
        },
      ],
    });
    const hint = (completion.choices[0]?.message?.content || "").trim();
    if (!hint) {
      return NextResponse.json({ error: "Could not generate a hint" }, { status: 500 });
    }
    return NextResponse.json({ hint });
  } catch (err) {
    console.error("[practice hint] failed:", err);
    return NextResponse.json({ error: "Failed to generate hint" }, { status: 500 });
  }
}
