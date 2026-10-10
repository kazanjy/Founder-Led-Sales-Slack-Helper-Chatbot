import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { CATEGORY_KEYS } from "@/lib/objection-library/categories";

export const maxDuration = 60;

// POST - Generate a handle and category for a given objection using AI
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { objection, orgPersona, humanPersona } = await request.json();

    if (!objection) {
      return NextResponse.json(
        { error: "Objection text is required" },
        { status: 400 }
      );
    }

    // Get the latest sales narrative for context
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { description100w: true, description50w: true },
    });

    const narrativeContext = latestNarrative?.description100w
      || latestNarrative?.description50w
      || "";

    const categoryList = CATEGORY_KEYS.join(", ");

    const prompt = `You are an expert B2B sales coach. Given a prospect objection, generate a tactical handle (response) and classify it into a category.

## OBJECTION:
"${objection}"

${orgPersona ? `## ORGANIZATION TYPE:\n${orgPersona}\n` : ""}
${humanPersona ? `## TARGET ROLE:\n${humanPersona}\n` : ""}
${narrativeContext ? `## PRODUCT CONTEXT:\n${narrativeContext}\n` : ""}

## INSTRUCTIONS:
1. Classify this objection into exactly ONE category from: ${categoryList}
2. Write a specific, tactical handle (response) for this objection
   - Use concrete details from the product context if available
   - Make it conversational and natural-sounding
   - Keep it practical, not generic sales advice
   - 2-4 sentences

## OUTPUT FORMAT:
Return ONLY valid JSON, no other text:
{"category": "CATEGORY_KEY", "handle": "Your tactical response here"}`;

    let aiResponse = "";
    try {
      const result = await sendToChatbase(prompt);
      aiResponse = result.response.trim();
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate handle. Please try again." },
        { status: 500 }
      );
    }

    // Clean up response - extract JSON
    let cleaned = aiResponse;
    // Remove markdown code fences if present
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\w*\n?/, "");
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Parse JSON
    let parsed: { category: string; handle: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: return the raw text as handle with default category
        return NextResponse.json({
          category: "PRODUCT",
          handle: cleaned,
        });
      }
    }

    // Validate category
    const category = CATEGORY_KEYS.includes(parsed.category) ? parsed.category : "PRODUCT";

    return NextResponse.json({
      category,
      handle: parsed.handle || cleaned,
    });
  } catch (error) {
    console.error("Error generating objection handle:", error);
    return NextResponse.json(
      { error: "Failed to generate objection handle" },
      { status: 500 }
    );
  }
}
