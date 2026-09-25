import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate LinkedIn sequence from sales narrative + persona
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
    const instructionPrompt = `You are an expert B2B social selling strategist helping a founder create a LinkedIn outreach sequence.

## INSTRUCTIONS:

Generate a LinkedIn outreach sequence targeting the specified persona. The sequence should include:

1. **Connection Request Note** — Leave this BLANK. Just write:
   > **Connection Request Note**
   > *(Personalize this — keep under 300 characters. Reference something specific about the person or their company. Don't pitch.)*
   Do NOT generate any sample text for the connection request.

2. **Follow-up Message 1** (after they accept, Day 1-2)
   - Thank them for connecting
   - Share a relevant insight, resource, or observation
   - End with an interest check, NOT a meeting ask (see CTA Strategy below)

3. **Follow-up Message 2** (Day 5-7)
   - Reference something specific from their profile / company / recent post
   - Validate the pain point with a curiosity question or a peer-benchmark prompt
   - Still no meeting ask — go for an opinion, a one-line yes/no, or "is this on your radar?"

4. **Follow-up Message 3** (Day 10-12)
   - First place a meeting / time ask is allowed
   - Frame it as a specific, low-cost outcome ("15 min to walk you through how X handled this — worth it?")
   - Avoid generic "let's hop on a call" language

5. **Breakup Message** (Day 14+)
   - Graceful, leave door open
   - No guilt or pressure

For each touchpoint include:
- **Message text** (conversational, not salesy)
- **Timing note** (when to send)
- **Character count** for connection request

The tone should be authentic, founder-to-exec, not templated.

## CTA STRATEGY (IMPORTANT):

Default to **interest checks** before ever asking for a meeting or time. The first two messages after connection acceptance should make it easy for the prospect to reply with a single sentence. Use CTAs like:

- "Curious whether [pain] is something your team is actively working on?"
- "Is this how you're seeing it too, or am I off-base?"
- "Would a tear-down of how [similar company] solved this be useful?"
- "Open to a 30-sec read on this?" (when sharing a link)
- "Hit me with a 'yes' or 'no' — I won't be offended either way."
- "What's your current take on [problem]?"

Only ask for a meeting in Follow-up Message 3 (or later). When you do, make it specific and low-cost:
- "15 minutes to walk you through how [similar company] solved this — worth it?"
- Anchor to a specific outcome, not "to learn about each other"

**Anti-patterns to avoid (do NOT do these):**
- Asking for "a quick call" or "15 minutes" in Follow-up 1 or 2
- Dropping a Calendly / scheduling link before any interest signal
- Generic "would love to chat" / "let's connect on a call" CTAs
- Pitching the product in the connection note or first follow-up

The arc should feel like a peer-to-peer conversation — pique interest → validate the problem → share proof → invite them to dig deeper — not five rephrasings of "let's get on a call."

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
      console.log(`[linkedin-sequence/generate] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending LinkedIn sequence prompt: ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate LinkedIn sequence. Please try again." },
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
    const version = await prisma.linkedInSequenceVersion.create({
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
    const reportUrl = `${appUrl}/linkedin-sequence?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "linkedin",
      orgPersona,
      humanPersona,
      specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.linkedInSequenceVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "LINKEDIN_SEQUENCE",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "LINKEDIN_SEQUENCE",
        name: "LinkedIn Sequence",
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
    console.error("Error generating LinkedIn sequence:", error);
    return NextResponse.json(
      { error: "Failed to generate LinkedIn sequence" },
      { status: 500 }
    );
  }
}
