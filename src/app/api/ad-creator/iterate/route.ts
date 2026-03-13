import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";
import { CHATBASE_MESSAGE_LIMIT, splitIntoChunks, buildChunkedHistory } from "@/lib/chatbase/chunking";

// Allow up to 120s for Chatbase AI generation
export const maxDuration = 120;

// POST - Iterate on an existing ad creator version
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { versionId, iterationNotes } = await request.json();

    if (!versionId || !iterationNotes?.trim()) {
      return NextResponse.json(
        { error: "Version ID and iteration notes are required" },
        { status: 400 }
      );
    }

    // Fetch the source version
    const sourceVersion = await prisma.adCreatorVersion.findFirst({
      where: { id: versionId, userId: user.id },
    });

    if (!sourceVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Build the iteration prompt
    const instructionPrompt = `You are an expert B2B performance marketing strategist. You are iterating on existing ad concepts based on user feedback.

## PREVIOUS AD CONCEPTS:

${sourceVersion.content}

## ITERATION GUIDANCE:

${iterationNotes.trim()}

## INSTRUCTIONS:

Generate a complete new set of ad concepts incorporating the feedback above. Keep what works well from the previous version, and improve or change what was called out in the iteration guidance.

Maintain the same platform sections and format as the previous version. Use ## headers for each platform section with anchor IDs in the format {#anchor-id}. Use ### for each concept variation.

Include a **Creative Direction** section for every ad concept describing visual concepts, imagery, mood, style, and composition.
${sourceVersion.tone ? `\n**Voice/Tone directive:** Write all ad copy in a ${sourceVersion.tone} tone. Let this voice permeate headlines, descriptions, and body copy consistently across all platforms.` : ""}
Return clean markdown (NO code blocks). Start with a brief # title line.`;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = instructionPrompt;

    if (instructionPrompt.length > CHATBASE_MESSAGE_LIMIT) {
      const contextChunks = splitIntoChunks(sourceVersion.content, CHATBASE_MESSAGE_LIMIT);
      chatbaseHistory = buildChunkedHistory(contextChunks, "Previous Ad Concepts");
      finalMessage = `You are an expert B2B performance marketing strategist iterating on ad concepts.

## ITERATION GUIDANCE:

${iterationNotes.trim()}

## INSTRUCTIONS:

Generate a complete new set of ad concepts incorporating the feedback above. Keep what works, improve what was called out. Maintain the same platform sections and format. Use ## headers with {#anchor-id}. Include Creative Direction for every concept.${sourceVersion.tone ? ` Write all ad copy in a ${sourceVersion.tone} tone.` : ""} Return clean markdown (NO code blocks).`;
      console.log(`[ad-creator/iterate] Chunked: ${contextChunks.length} chunks`);
    }

    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to iterate on ad concepts. Please try again." },
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

    // Save new version with iteration lineage
    const newVersion = await prisma.adCreatorVersion.create({
      data: {
        userId: user.id,
        salesNarrativeVersionId: sourceVersion.salesNarrativeVersionId,
        firstCallChecklistVersionId: sourceVersion.firstCallChecklistVersionId,
        orgPersona: sourceVersion.orgPersona,
        humanPersona: sourceVersion.humanPersona,
        specialNotes: sourceVersion.specialNotes,
        tone: sourceVersion.tone,
        platforms: sourceVersion.platforms,
        content: cleanedResponse,
        iteratedFromId: sourceVersion.id,
        iterationNotes: iterationNotes.trim(),
      },
    });

    // Create linked chat conversation
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const reportUrl = `${appUrl}/ad-creator?version=${newVersion.id}`;

    const conversation = await createSequenceConversation({
      userId: user.id,
      sequenceType: "ad-creator",
      orgPersona: sourceVersion.orgPersona,
      humanPersona: sourceVersion.humanPersona,
      specialNotes: sourceVersion.specialNotes,
      content: cleanedResponse,
      reportUrl,
    });

    await prisma.adCreatorVersion.update({
      where: { id: newVersion.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "AD_CREATOR",
        },
      },
      update: { value: cleanedResponse },
      create: {
        userId: user.id,
        mergeField: "AD_CREATOR",
        name: "Ad Creator",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: newVersion.id,
        content: cleanedResponse,
        orgPersona: sourceVersion.orgPersona,
        humanPersona: sourceVersion.humanPersona,
        specialNotes: sourceVersion.specialNotes,
        tone: sourceVersion.tone,
        platforms: sourceVersion.platforms,
        iteratedFromId: sourceVersion.id,
        iterationNotes: iterationNotes.trim(),
        salesNarrativeVersionId: sourceVersion.salesNarrativeVersionId,
        firstCallChecklistVersionId: sourceVersion.firstCallChecklistVersionId,
        conversationId: conversation.id,
        createdAt: newVersion.createdAt,
        updatedAt: newVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error iterating ad concepts:", error);
    return NextResponse.json(
      { error: "Failed to iterate on ad concepts" },
      { status: 500 }
    );
  }
}
