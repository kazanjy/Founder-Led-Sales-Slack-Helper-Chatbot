import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 60;

// POST - Generate topic suggestions from the user's sales narrative
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { platform } = await request.json();
    const platformLabel = platform === "twitter" ? "Twitter/X" : "LinkedIn";

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

    const narrativeSummary =
      latestNarrative.description1000w ||
      latestNarrative.description100w ||
      latestNarrative.description50w ||
      latestNarrative.narrative.substring(0, 3000);

    const prompt = `You MUST respond ONLY with valid JSON (no markdown, no explanation, no code blocks).
Required format: { "topics": ["topic 1", "topic 2", ...] }

Based on this sales narrative, suggest 8-10 compelling ${platformLabel} post topics that a founder could write about. Mix between:
- Industry insights and hot takes
- Lessons learned building the product
- Pain points their customers face
- Contrarian or surprising perspectives
- Behind-the-scenes of the business

Sales Narrative Summary:
${narrativeSummary}`;

    let aiResponse: string;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
      });
      aiResponse = response.choices[0]?.message?.content?.trim() || "";
    } catch (openaiError) {
      console.error("[topic-suggestions] OpenAI error:", openaiError);
      return NextResponse.json(
        { error: "AI service is temporarily unavailable." },
        { status: 502 }
      );
    }

    // Strip code blocks
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
        { error: "AI returned unexpected format." },
        { status: 422 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        { error: "AI returned malformed data." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      topics: parsed.topics || [],
    });
  } catch (error) {
    console.error("[topic-suggestions] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to generate topic suggestions." },
      { status: 500 }
    );
  }
}
