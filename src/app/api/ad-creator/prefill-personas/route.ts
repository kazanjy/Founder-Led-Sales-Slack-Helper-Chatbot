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

    // Use the shorter descriptions to stay well under the Chatbase 7500-char limit.
    const narrativeSummary =
      latestNarrative.description100w ||
      latestNarrative.description50w ||
      latestNarrative.description25w ||
      latestNarrative.narrative.substring(0, 2000);

    const prompt = `You MUST respond ONLY with valid JSON (no markdown, no explanation, no code blocks).
Required format: { "orgPersona": "...", "humanPersona": "..." }

Based on this sales narrative, suggest the most likely:
1. orgPersona — the type of company they sell to (e.g. "Series B SaaS company", "Enterprise manufacturing firm")
2. humanPersona — the buyer role they should target with ads (e.g. "VP of Sales", "Head of Engineering")

Sales Narrative Summary:
${narrativeSummary}`;

    let chatbaseResult;
    try {
      chatbaseResult = await sendToChatbase(prompt);
    } catch (chatbaseError) {
      console.error("[ad-creator/prefill-personas] Chatbase API call failed:", chatbaseError);
      return NextResponse.json(
        { error: "AI service is temporarily unavailable. You can fill in the personas manually." },
        { status: 502 }
      );
    }

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
      console.error("[ad-creator/prefill-personas] No JSON found in AI response:", aiResponse.substring(0, 500));
      return NextResponse.json(
        { error: "AI returned an unexpected format. You can fill in the personas manually." },
        { status: 422 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("[ad-creator/prefill-personas] JSON parse failed:", parseError, "Raw:", jsonMatch[0].substring(0, 500));
      return NextResponse.json(
        { error: "AI returned malformed data. You can fill in the personas manually." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      orgPersona: parsed.orgPersona || "",
      humanPersona: parsed.humanPersona || "",
    });
  } catch (error) {
    console.error("[ad-creator/prefill-personas] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to prefill personas. You can fill them in manually." },
      { status: 500 }
    );
  }
}
