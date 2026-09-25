import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate sales deck outline from sales narrative + persona
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgPersona, humanPersona, specialNotes, deckMode, includeFirstCallChecklist, existingDeckContent, existingDeckFileName } = await request.json();

    if (!orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Organization persona and target role are required" },
        { status: 400 }
      );
    }

    const resolvedMode = deckMode === "existing" ? "existing" : "fresh";

    if (resolvedMode === "existing" && !existingDeckContent) {
      return NextResponse.json(
        { error: "Please upload your existing deck PDF to use 'Improve Existing' mode." },
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

    // Optionally get first call checklist
    let checklistContent: string | null = null;
    let checklistVersionId: string | null = null;
    if (includeFirstCallChecklist) {
      const latestChecklist = await prisma.firstCallChecklistVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (latestChecklist) {
        checklistContent = latestChecklist.content;
        checklistVersionId = latestChecklist.id;
      }
    }

    // Build the prompt — instructions first so they survive truncation
    const personaSection = `## TARGET PERSONA:

- **Organization type:** ${orgPersona}
- **Target role:** ${humanPersona}
${specialNotes ? `- **Special notes:** ${specialNotes}` : ""}`;

    // Build context section (variable-length content)
    let contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;
    if (checklistContent) {
      contextSection += `\n\n## FIRST CALL CHECKLIST (for additional context):\n\n${checklistContent}`;
    }
    if (existingDeckContent) {
      contextSection += `\n\n## EXISTING DECK CONTENT${existingDeckFileName ? ` (from "${existingDeckFileName}")` : ""}:\n\n${existingDeckContent}`;
    }

    // Instructions go in final message; context goes in history if too long
    const hasExistingDeck = !!existingDeckContent;
    const instructionPrompt = buildDeckPrompt(personaSection, "", resolvedMode, hasExistingDeck);
    const fullPrompt = buildDeckPrompt(personaSection, contextSection, resolvedMode, hasExistingDeck);

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      // Send context as chunked history, instructions as final message
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Context");
      finalMessage = instructionPrompt;
      console.log(`[sales-deck/generate] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending sales deck prompt (${resolvedMode}): ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate sales deck. Please try again." },
        { status: 500 }
      );
    }

    // Clean up the response
    let cleanedResponse = aiResponse.trim();
    if (cleanedResponse.startsWith("```markdown")) {
      cleanedResponse = cleanedResponse.slice(11);
    } else if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.slice(3);
    }
    if (cleanedResponse.endsWith("```")) {
      cleanedResponse = cleanedResponse.slice(0, -3);
    }
    cleanedResponse = cleanedResponse.trim();

    // Save to DB
    const version = await prisma.salesDeckVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        deckMode: resolvedMode,
        content: cleanedResponse,
        sourcePdfName: existingDeckFileName || null,
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/sales-deck?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "sales-deck",
      orgPersona,
      humanPersona,
      specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.salesDeckVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "SALES_DECK",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "SALES_DECK",
        name: "Sales Deck",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        content: cleanedResponse,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        deckMode: resolvedMode,
        sourcePdfName: existingDeckFileName || null,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        conversationId: conversation.id,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating sales deck:", error);
    return NextResponse.json(
      { error: "Failed to generate sales deck" },
      { status: 500 }
    );
  }
}

function buildDeckPrompt(personaSection: string, contextSection: string, mode: string, hasExistingDeck: boolean = false): string {
  if (mode === "existing" && hasExistingDeck) {
    return buildExistingDeckPrompt(personaSection, contextSection);
  }

  return `You are an expert B2B sales presentation coach helping a founder create a compelling sales deck outline with speaker notes.

## INSTRUCTIONS:

The user needs a BRAND NEW sales deck outline and speaker script created from their sales narrative.

Generate a complete sales deck outline targeting the specified persona. For each slide, include:
- **Slide title**
- **Key visual / layout suggestion** (what should be on the slide visually)
- **Speaker script** (exactly what the presenter should say — conversational, not robotic)
- **Transition** (how to smoothly move to the next slide)

The deck MUST include these sections in order:

### 1. TITLE SLIDE
- Company name + tagline
- Presenter name/title
- Speaker script: How to open with energy and set the tone

### 2. THE PROBLEM (2-3 slides)
- Paint the prospect's pain vividly — make them feel understood
- Use specific data points or scenarios from the narrative
- Build urgency: what happens if they do nothing?
- Speaker script should be story-driven, not bullet-point reading

### 3. THE SOLUTION (2-3 slides)
- How your product/service solves the problem
- Key differentiators — why you vs. alternatives
- Keep it benefit-focused, not feature-dumping
- Speaker script should connect each benefit back to the pain

### 4. HOW IT WORKS (1-2 slides)
- Simple visual walkthrough of the product/process
- 3-step or 4-step framework if possible
- Speaker script should make the complex feel simple

### 5. PROOF / SOCIAL PROOF (1-2 slides)
- Customer results, case studies, testimonials
- Specific metrics and outcomes
- Speaker script should tell a brief customer story

### 6. THE ASK / NEXT STEPS (1 slide)
- Clear call to action
- What happens after they say yes
- Timeline and expectations
- Speaker script should create urgency without being pushy

### 7. APPENDIX / FAQ (1-2 slides)
- Common questions and answers
- Pricing framework (if appropriate)
- Technical details for follow-up

${personaSection}

## TONE:
- Conversational, founder-to-executive
- Confident and authoritative, not salesy
- Story-driven with data to back it up
- Every slide should earn the right to show the next one

## OUTPUT FORMAT:
Return clean markdown (NO code blocks). Use headers (## for slide titles), bold text, and clear structure. Each slide should be clearly delineated.
${contextSection ? `\n${contextSection}` : ""}`;
}

function buildExistingDeckPrompt(personaSection: string, contextSection: string): string {
  return `You are an expert B2B sales presentation coach. The user has uploaded their existing sales deck and wants you to analyze it and provide a comprehensive improved version.

## INSTRUCTIONS:

Analyze the user's existing deck (provided in the context below) and produce an IMPROVED version. Your output should:

1. **Audit the existing deck** — identify what's strong, what's weak, and what's missing
2. **Produce an improved deck outline** that keeps the best parts of their existing deck while fixing gaps

For the improved deck, evaluate and address:
- **Missing slides** — Are any critical sections missing (problem framing, social proof, clear CTA, etc.)?
- **Slide ordering** — Is the narrative arc logical? Does each slide earn the right to show the next one?
- **Messaging strength** — Are value props clear and benefit-focused rather than feature-dumping?
- **Proof points** — Are there enough concrete data points, case studies, or testimonials?
- **Call to action** — Is the ask clear and compelling?
- **Speaker script quality** — Would the talking points sound natural and persuasive?

## OUTPUT FORMAT:

Start with a brief **## Deck Audit** section (3-5 bullet points) summarizing the key strengths and gaps you identified in the existing deck.

Then provide the full **improved deck outline**. For each slide, include:
- **Slide title**
- **Key visual / layout suggestion**
- **Speaker script** (conversational, not robotic)
- **Transition** to the next slide
- If the slide is **new** (not in the original deck), mark it with: ⭐ *New slide*
- If the slide is **significantly revised**, mark it with: ✏️ *Revised*

${personaSection}

## TONE:
- Conversational, founder-to-executive
- Confident and authoritative, not salesy
- Story-driven with data to back it up
- Every slide should earn the right to show the next one

Return clean markdown (NO code blocks). Use headers (## for slide titles), bold text, and clear structure.
${contextSection ? `\n${contextSection}` : ""}`;
}
