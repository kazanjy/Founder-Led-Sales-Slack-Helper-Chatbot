import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate email sequence from sales narrative + persona
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgPersona, humanPersona, specialNotes, includeFirstCallChecklist } = await request.json();

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

    // Build context (variable-length)
    let contextSection = `## SALES NARRATIVE:\n\n${latestNarrative.narrative}`;
    if (checklistContent) {
      contextSection += `\n\n## FIRST CALL CHECKLIST (for additional context):\n\n${checklistContent}`;
    }

    // Instructions first so they survive truncation
    const instructionPrompt = `You are an expert B2B outbound sales copywriter helping a founder create a cold email sequence.

## INSTRUCTIONS:

Generate a cold email outreach sequence targeting the specified persona. You decide the optimal number of emails (typically 3-5) and structure based on the product, persona, and context provided.

Each email should include:
- **Subject line** (compelling, not spammy)
- **Body** (concise, value-focused, conversational tone)
- **Send timing note** (e.g., "Day 1", "Day 3", "Day 7")

The sequence should:
- Lead with the prospect's pain, not the product
- Be personalized to the organizational and human persona
- Keep emails short (under 150 words each)
- Progress from introduction → curiosity / proof → soft meeting ask → breakup

## CTA STRATEGY (IMPORTANT):

Default to **interest checks** before ever asking for a meeting or time. The job of the first 1-2 emails is to find out whether the prospect cares about the problem at all. Use CTAs that lower the cost of replying:

- "Is [this pain] something you're actively working on right now?"
- "Curious whether this resonates — is this a real problem for your team?"
- "Worth a 30-second read?" (when sharing a resource)
- "Would a tear-down of how [similar company] handled this be useful?"
- "Hit reply with 'yes' or 'no' — I won't be offended either way."
- "What's your current thinking on [problem]?"

Only escalate to a meeting / time ask in the FINAL 1-2 emails, after you've earned curiosity. When you do ask, frame it as "low-cost / specific outcome":
- "15 minutes to walk you through how [similar company] solved this — worth it?"
- Suggest a specific time window, not "your calendar"

**Anti-patterns to avoid (do NOT do these):**
- Asking for "a quick 15 minutes" or "30 mins on your calendar" in the first email
- Generic "let's hop on a call" CTAs before any interest signal
- Calendly / scheduling links in the opener
- "Worth a chat?" before establishing any value

The progression should feel like a conversation — pique interest → validate the problem → share proof → invite them to dig deeper — rather than five variations of "let's meet."

## TARGET PERSONA:

- **Organization type:** ${orgPersona}
- **Target role:** ${humanPersona}
${specialNotes ? `- **Special notes:** ${specialNotes}` : ""}

## OUTPUT FORMAT:

Return clean markdown (NO code blocks). Use headers, bold text, and clear structure.`;

    const fullPrompt = `${instructionPrompt}\n\n${contextSection}`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Context");
      finalMessage = instructionPrompt;
      console.log(`[email-sequence/generate] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending email sequence prompt: ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate email sequence. Please try again." },
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
    const version = await prisma.emailSequenceVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        content: cleanedResponse,
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/email-sequence?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "email",
      orgPersona,
      humanPersona,
      specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.emailSequenceVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "EMAIL_SEQUENCE",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "EMAIL_SEQUENCE",
        name: "Email Sequence",
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
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        conversationId: conversation.id,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating email sequence:", error);
    return NextResponse.json(
      { error: "Failed to generate email sequence" },
      { status: 500 }
    );
  }
}
