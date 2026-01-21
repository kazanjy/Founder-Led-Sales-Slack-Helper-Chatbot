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
  const { message } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

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
  let titlePromise: Promise<string> | null = null;

  if (isFirstMessage) {
    // Start AI title generation (runs in parallel with Chatbase)
    titlePromise = generateChatTitle(message);

    // Update preview immediately
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { firstMessagePreview: message.substring(0, 100) },
    });
  }

  // Get conversation history for context
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  // Expand merge fields in history too for context
  const chatbaseHistory = await Promise.all(
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

  try {
    // Get response from Chatbase (send expanded message)
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

    // Now wait for title generation (should already be done since OpenAI is faster than Chatbase)
    let generatedTitle: string | null = null;
    if (titlePromise) {
      generatedTitle = await titlePromise;
      // Save title to DB
      if (generatedTitle && generatedTitle !== "New Conversation") {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { title: generatedTitle },
        });
      }
    }

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
      // Include generated title if this was the first message
      generatedTitle: isFirstMessage ? generatedTitle : null,
    });
  } catch (error) {
    console.error("Error getting Chatbase response:", error);
    return NextResponse.json(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  }
}
