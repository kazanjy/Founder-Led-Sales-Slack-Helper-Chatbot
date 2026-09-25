import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Generate cold call script from sales narrative + persona
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgPersona, humanPersona, specialNotes, scriptType, includeFirstCallChecklist } = await request.json();

    if (!orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Organization persona and target role are required" },
        { status: 400 }
      );
    }

    const validScriptTypes = ["outbound", "inbound"];
    const resolvedType = validScriptTypes.includes(scriptType) ? scriptType : "outbound";

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

    // Instructions go in final message; context goes in history if too long
    const instructionPrompt = resolvedType === "outbound"
      ? buildOutboundPrompt(personaSection, "")
      : buildInboundPrompt(personaSection, "");

    const fullPrompt = resolvedType === "outbound"
      ? buildOutboundPrompt(personaSection, contextSection)
      : buildInboundPrompt(personaSection, contextSection);

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = fullPrompt;

    if (fullPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      // Send context as chunked history, instructions as final message
      const contextChunks = splitIntoChunks(contextSection, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Context");
      finalMessage = instructionPrompt;
      console.log(`[cold-call-script/generate] Chunked: ${contextChunks.length} chunks, final message: ${finalMessage.length} chars`);
    }

    console.log(`Sending cold call script prompt (${resolvedType}): ${finalMessage.length} chars (history: ${chatbaseHistory.length} msgs)`);

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate cold call script. Please try again." },
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
    const version = await prisma.coldCallScriptVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        orgPersona,
        humanPersona,
        specialNotes: specialNotes || null,
        scriptType: resolvedType,
        content: cleanedResponse,
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/call-scripts?version=${version.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "cold-call",
      orgPersona,
      humanPersona,
      specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    // Update version with conversation ID
    await prisma.coldCallScriptVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "COLD_CALL_SCRIPT",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "COLD_CALL_SCRIPT",
        name: "Cold Call Script",
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
        scriptType: resolvedType,
        salesNarrativeVersionId: latestNarrative.id,
        firstCallChecklistVersionId: checklistVersionId,
        conversationId: conversation.id,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating cold call script:", error);
    return NextResponse.json(
      { error: "Failed to generate cold call script" },
      { status: 500 }
    );
  }
}

function buildOutboundPrompt(personaSection: string, contextSection: string): string {
  return `You are an expert B2B cold calling coach helping a founder create a cold call script.

## INSTRUCTIONS:

Generate a complete outbound cold call script targeting the specified persona.

The script MUST include these sections in order:

### 1. PATTERN INTERRUPT OPENER
- A disarming, unexpected opening line that breaks the prospect out of "salesperson filter" mode
- NOT "How are you today?" or "Did I catch you at a bad time?"
- Should acknowledge the cold call honestly and create curiosity
- Include 2-3 opener variations the caller can rotate

### 2. QUICK ELEVATOR PITCH (15-20 seconds max)
- One sentence on who you help
- One sentence on the specific pain you solve
- One sentence on the outcome/result
- Must be conversational, not robotic

### 3. QUALIFYING QUESTIONS (2-3 questions)
- Questions to confirm fit and uncover pain
- Open-ended, not yes/no
- Designed to get the prospect talking

### 4. CLOSE FOR MEETING
- Transition from qualifying to booking
- Specific ask for 15-20 minute meeting
- Include the "give to get" — what they'll learn/get from the meeting
- Handle the calendar logistics naturally

### 5. TOP 10 OBJECTION HANDLES
For each objection, provide:
- The exact objection the prospect says
- The recommended response (conversational, empathetic, redirect)

Must include these common objections:
1. "I'm not interested"
2. "Send me an email"
3. "We already have a solution for that"
4. "I don't have time right now"
5. "What's this about?" / "Who are you?"
6. "How did you get my number?"
7. "We don't have the budget"
8. "I need to talk to my team"
9. "Call me back later" / "Now's not a good time"
10. "We're locked into a contract"

### 6. VOICEMAIL SCRIPT
- 20-30 second voicemail script
- Pattern interrupt + one pain point + soft CTA
- Include a follow-up voicemail for attempt #2

${personaSection}

## TONE:
- Conversational, founder-to-executive
- Confident but not pushy
- Curious and consultative
- Never salesy or scripted-sounding

## OUTPUT FORMAT:
Return clean markdown (NO code blocks). Use headers, bold text, and clear structure.
${contextSection ? `\n${contextSection}` : ""}`;
}

function buildInboundPrompt(personaSection: string, contextSection: string): string {
  return `You are an expert B2B sales coach helping a founder create an inbound lead response script.

## INSTRUCTIONS:

Generate a complete inbound lead response call script for when a prospect has shown interest (downloaded content, requested a demo, filled out a form, etc.).

The script MUST include these sections in order:

### 1. OPENING / PATTERN INTERRUPT
- Acknowledge their action/interest immediately
- Create rapport quickly — they reached out, honor that
- Transition from "thanks for reaching out" to qualifying
- Include 2-3 opener variations based on lead source (demo request, content download, referral)

### 2. QUICK ELEVATOR PITCH (10-15 seconds)
- Shorter than outbound — they already know something about you
- Focus on confirming what they think you do and expanding it
- Bridge to discovery

### 3. QUALIFICATION FRAMEWORK (BANT-style)
- 4-6 qualifying questions to assess fit
- Questions about: current situation, pain severity, timeline, decision process, budget
- Designed to determine if this is a real opportunity
- Open-ended, gets prospect talking about their problems

### 4. CLOSE FOR NEXT STEP
- If qualified: Book a deeper discovery/demo call
- If not qualified: Graceful off-ramp with nurture path
- Specific ask with clear value proposition for the next meeting
- Handle calendar logistics

### 5. TOP 10 OBJECTION HANDLES
For each objection, provide:
- The exact objection
- The recommended response

Must include these inbound-specific objections:
1. "I was just looking / browsing"
2. "Can you just send me some info?"
3. "I'm not the decision maker"
4. "We're just starting to research"
5. "Your pricing seems high"
6. "How are you different from [competitor]?"
7. "We need to see a demo first"
8. "I need to loop in my team before we go further"
9. "We're not ready to buy right now"
10. "I downloaded [content] but I'm not really in-market"

### 6. FOLLOW-UP CADENCE
- What to do if they don't answer (timing, channels)
- Voicemail script for follow-up
- Text/email follow-up templates (1-2 sentences each)

${personaSection}

## TONE:
- Warm, consultative, appreciative of their interest
- Confident but not assumptive
- Qualifying without interrogating
- Founder-to-executive peer conversation

## OUTPUT FORMAT:
Return clean markdown (NO code blocks). Use headers, bold text, and clear structure.
${contextSection ? `\n${contextSection}` : ""}`;
}
