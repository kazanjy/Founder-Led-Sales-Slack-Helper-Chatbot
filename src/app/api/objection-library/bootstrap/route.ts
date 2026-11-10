import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Bootstrap generation: creates 8-10 objection entries from sales narrative
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgPersona, humanPersona } = await request.json();

    if (!orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Organization persona and target role are required" },
        { status: 400 }
      );
    }

    // Get the latest sales narrative
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found. Please create a sales narrative first." },
        { status: 400 }
      );
    }

    // Build the prompt
    const instructionPrompt = `You are an expert B2B sales coach helping a founder build their objection handling library.

## INSTRUCTIONS:
Generate 8-10 common objections that prospects would raise when evaluating this product. Focus on objections related to:
- Product fit & capabilities (does it solve the problem?)
- ROI & value justification (can they justify the spend?)
- Adoption & implementation (will the team use it?)
- Competition & alternatives (including build-vs-buy)
- Trust & vendor risk (are you too early-stage?)

For each objection, provide:
1. The objection (what the prospect actually says)
2. The category (one of: NEED, PRIORITY, ROI, PRODUCT, COMPETITION, ADOPTION, BUDGET, TRUST, AUTHORITY)
3. A specific, tactical handle (how to respond — use concrete details from the sales narrative, not generic sales advice)

## TARGET PERSONA:
- Organization type: ${orgPersona}
- Target role: ${humanPersona}

## OUTPUT FORMAT:
Return a JSON array. Each element: { "objection": "...", "category": "...", "handle": "..." }
Do NOT wrap in code blocks. Return only the JSON array.`;

    const contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = `${instructionPrompt}\n\n${contextSection}`;

    if (finalMessage.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Context");
      finalMessage = instructionPrompt;
      console.log(`[objection-library/bootstrap] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending objection bootstrap prompt: ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate objections. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let cleaned = aiResponse.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[objection-library/bootstrap] No JSON array found in response:", cleaned.substring(0, 500));
      return NextResponse.json(
        { error: "AI returned an unexpected format. Please try again." },
        { status: 422 }
      );
    }

    let parsed: Array<{ objection: string; category: string; handle: string }>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("[objection-library/bootstrap] JSON parse failed:", parseError);
      return NextResponse.json(
        { error: "AI returned malformed data. Please try again." },
        { status: 422 }
      );
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json(
        { error: "AI returned empty results. Please try again." },
        { status: 422 }
      );
    }

    // Validate categories
    const validCategories = new Set([
      "NEED", "PRIORITY", "ROI", "PRODUCT", "COMPETITION",
      "ADOPTION", "BUDGET", "TRUST", "AUTHORITY",
    ]);

    const validEntries = parsed.filter(
      (e) => e.objection && e.category && e.handle && validCategories.has(e.category.toUpperCase())
    );

    if (validEntries.length === 0) {
      return NextResponse.json(
        { error: "AI returned no valid entries. Please try again." },
        { status: 422 }
      );
    }

    // Create entries in bulk
    const entries = await Promise.all(
      validEntries.map((e, i) =>
        prisma.objectionEntry.create({
          data: {
            userId: user.id,
            objection: e.objection,
            category: e.category.toUpperCase() as never,
            handle: e.handle,
            orgPersona,
            humanPersona,
            source: "bootstrap",
            sortOrder: i,
          },
        })
      )
    );

    // Record the bootstrap run
    await prisma.objectionBootstrap.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        orgPersona,
        humanPersona,
        entryCount: entries.length,
      },
    });

    return NextResponse.json({
      success: true,
      entries,
      count: entries.length,
    });
  } catch (error) {
    console.error("Error bootstrapping objection library:", error);
    return NextResponse.json(
      { error: "Failed to bootstrap objection library" },
      { status: 500 }
    );
  }
}
