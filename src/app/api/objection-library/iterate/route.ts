import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

export const maxDuration = 60;

// POST - Improve an existing handle via Chatbase chat
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { entryId, feedback } = await request.json();

    if (!entryId || !feedback) {
      return NextResponse.json(
        { error: "Entry ID and feedback are required" },
        { status: 400 }
      );
    }

    const entry = await prisma.objectionEntry.findFirst({
      where: { id: entryId, userId: user.id },
    });

    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
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

    const prompt = `You are an expert B2B sales coach. Improve this objection handle based on the user's feedback.

## CURRENT OBJECTION:
"${entry.objection}"

## CURRENT HANDLE (response):
${entry.handle}

## USER'S FEEDBACK:
${feedback}

${narrativeContext ? `## PRODUCT CONTEXT:\n${narrativeContext}\n` : ""}
## INSTRUCTIONS:
- Provide an improved version of the handle that addresses the user's feedback
- Keep it specific and tactical (not generic sales advice)
- Make it conversational and natural-sounding
- Return ONLY the improved handle text, nothing else`;

    let aiResponse = "";
    try {
      const result = await sendToChatbase(prompt);
      aiResponse = result.response.trim();
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to improve handle. Please try again." },
        { status: 500 }
      );
    }

    // Clean up
    let cleaned = aiResponse;
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\w*\n?/, "");
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Update the entry in-place
    const updatedEntry = await prisma.objectionEntry.update({
      where: { id: entryId },
      data: { handle: cleaned },
    });

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    console.error("Error iterating objection handle:", error);
    return NextResponse.json(
      { error: "Failed to improve objection handle" },
      { status: 500 }
    );
  }
}
