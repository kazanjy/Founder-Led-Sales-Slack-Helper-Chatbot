import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendToChatbase } from "@/lib/chatbase/client";
import { expandMergeFields, findMergeFields } from "@/lib/default-gtm-variables";
import { generateChatTitle } from "@/lib/openai";

/**
 * POST /api/conversations/[id]/messages - Send a message in a conversation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if user can chat
  const chatStatus = canUserChat(user);
  if (!chatStatus.allowed) {
    return NextResponse.json(
      { error: chatStatus.message, blocked: true },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { message, attachments } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

  // Sales narrative is default-on. Body-supplied `attachments` (even an
  // empty array) is an explicit choice; an omitted `attachments` field
  // resolves to the default. Matches the stream-route semantics so the
  // Chatbase + raw-GPT paths share one invariant: server loads, user
  // opts out.
  const requestedAttachments: string[] = Array.isArray(attachments)
    ? (attachments as string[]).filter((a) => a === "salesNarrative")
    : ["salesNarrative"];

  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  if (conversation.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check for merge fields and expand them
  const mergeFieldsInMessage = findMergeFields(message);
  let expandedMessage = message;
  let usedVariables: string[] = [];
  let missingVariables: string[] = [];

  if (mergeFieldsInMessage.length > 0) {
    // Fetch user's GTM variables
    const userVariables = await prisma.gtmVariable.findMany({
      where: { userId: user.id },
      select: { mergeField: true, value: true },
    });

    // Expand the merge fields
    const expansion = expandMergeFields(message, userVariables);
    expandedMessage = expansion.expanded;
    usedVariables = expansion.usedVariables;
    missingVariables = expansion.missingVariables;
  }

  // Per-conversation attachment lock: first message decides, subsequent
  // messages respect the lock. Sales narrative is the only attachment
  // that flows through Chatbase (the other context types live behind
  // the raw-GPT path's attachment picker).
  const existingAttachments = conversation.attachmentsIncluded as string[] | null;
  const isFirstChoiceForConversation = existingAttachments == null;
  const effectiveAttachments = isFirstChoiceForConversation
    ? requestedAttachments
    : existingAttachments;
  const shouldInjectNarrative =
    isFirstChoiceForConversation &&
    effectiveAttachments.includes("salesNarrative") &&
    !conversation.chatbaseConversationId;

  if (shouldInjectNarrative) {
    const narrativeVar = await prisma.gtmVariable.findFirst({
      where: { userId: user.id, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    });
    const narrative = (narrativeVar?.value || "").trim();
    if (narrative) {
      expandedMessage = `${expandedMessage}\n\n--- SALES NARRATIVE (Context about the user's product/service) ---\n\n${narrative}\n\n--- END SALES NARRATIVE ---`;
      console.log(`[Chat -> Chatbase] Appended Sales Narrative context for user ${user.id}`);
    }
  }

  // Save user message (store original with merge fields for display)
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  // Update conversation preview and start AI title generation if this is the first message
  const isFirstMessage = !conversation.firstMessagePreview;

  if (isFirstMessage) {
    // Persist the attachment decision alongside the preview — locks
    // the per-conversation opt-out (or opt-in) for every subsequent
    // message.
    const update: Record<string, unknown> = {
      firstMessagePreview: message.substring(0, 100),
    };
    if (isFirstChoiceForConversation) {
      update.attachmentsIncluded = effectiveAttachments;
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: update,
    });

    // Fire-and-forget: Start AI title generation (saves to DB when done)
    // Don't await - let it run in background while Chatbase processes
    generateChatTitle(message).then(async (generatedTitle) => {
      if (generatedTitle && generatedTitle !== "New Conversation") {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { title: generatedTitle },
        });
        console.log(`[Title] Saved title for conversation ${conversation.id}: ${generatedTitle}`);
      }
    }).catch((err) => {
      console.error("[Title] Error generating title:", err);
    });
  }

  // Build conversation history only if we don't have a Chatbase conversation ID yet
  // When we have a conversationId, Chatbase persists context on their end
  let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (!conversation.chatbaseConversationId) {
    // First message in this conversation - need to send any existing history
    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    // Expand merge fields in history too for context
    chatbaseHistory = await Promise.all(
      history.slice(0, -1).map(async (msg) => {
        let content = msg.content;
        // Only expand user messages (assistant messages don't have merge fields)
        if (msg.role === "USER" && findMergeFields(msg.content).length > 0) {
          const userVariables = await prisma.gtmVariable.findMany({
            where: { userId: user.id },
            select: { mergeField: true, value: true },
          });
          const expansion = expandMergeFields(msg.content, userVariables);
          content = expansion.expanded;
        }
        return {
          role: msg.role.toLowerCase() as "user" | "assistant",
          content,
        };
      })
    );
  }

  try {
    // Get response from Chatbase (send expanded message)
    // If we have a conversationId, Chatbase already has the context - just send the new message
    const { response, conversationId: chatbaseConvId } = await sendToChatbase(
      expandedMessage,
      conversation.chatbaseConversationId || undefined,
      chatbaseHistory
    );

    // Update conversation with Chatbase ID if we got one
    if (chatbaseConvId && !conversation.chatbaseConversationId) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { chatbaseConversationId: chatbaseConvId },
      });
    }

    // Save assistant message
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: response,
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      },
    });

    return NextResponse.json({
      message: {
        id: assistantMessage.id,
        role: "ASSISTANT",
        content: response,
        createdAt: assistantMessage.createdAt,
      },
      // Include expansion info for the frontend to display
      expansion: mergeFieldsInMessage.length > 0 ? {
        originalMessage: message,
        expandedMessage,
        usedVariables,
        missingVariables,
      } : null,
      // Tell frontend to poll for title if this was the first message
      pollForTitle: isFirstMessage,
    });
  } catch (error) {
    console.error("Error getting Chatbase response:", error);
    return NextResponse.json(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  }
}
