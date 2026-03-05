import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

export const maxDuration = 60;

// POST - AI prefill org/human persona from sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found." },
        { status: 400 }
      );
    }

    const prompt = `Based on this sales narrative, suggest the most likely:
1. Organizational persona — the type of company they sell to (e.g. "Series B SaaS company", "Enterprise manufacturing firm")
2. Human persona — the buyer role they should target (e.g. "VP of Sales", "Head of Engineering")

Sales Narrative:
${latestNarrative.narrative}

Respond ONLY with valid JSON (no markdown, no code blocks): { "orgPersona": "...", "humanPersona": "..." }`;

    const chatbaseResult = await sendToChatbase(prompt);
    let aiResponse = chatbaseResult.response.trim();

    // Strip code blocks if present
    if (aiResponse.startsWith("```json")) {
      aiResponse = aiResponse.slice(7);
    } else if (aiResponse.startsWith("```")) {
      aiResponse = aiResponse.slice(3);
    }
    if (aiResponse.endsWith("```")) {
      aiResponse = aiResponse.slice(0, -3);
    }
    aiResponse = aiResponse.trim();

    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      orgPersona: parsed.orgPersona || "",
      humanPersona: parsed.humanPersona || "",
    });
  } catch (error) {
    console.error("Error prefilling personas:", error);
    return NextResponse.json(
      { error: "Failed to prefill personas" },
      { status: 500 }
    );
  }
}
