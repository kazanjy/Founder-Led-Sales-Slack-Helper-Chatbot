import { NextRequest } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendToChatbase } from "@/lib/chatbase/client";
import { expandMergeFields, findMergeFields } from "@/lib/default-gtm-variables";
import { generateChatTitle } from "@/lib/openai";

// Helper to simulate streaming by splitting response into word chunks
function* chunkResponse(text: string): Generator<string> {
  // Split by words but keep punctuation attached
  const words = text.split(/(\s+)/);
  let buffer = "";

  for (const word of words) {
    buffer += word;
    // Send every 2-4 words for natural streaming feel
    if (buffer.split(/\s+/).filter(w => w.length > 0).length >= 3 || buffer.includes("\n\n")) {
      yield buffer;
      buffer = "";
    }
  }

  // Send any remaining content
  if (buffer) {
    yield buffer;
  }
}

/**
 * POST /api/conversations/[id]/messages/stream - Send a message and stream the response
 * Returns a Server-Sent Events stream with the response chunks
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if user can chat
  const chatStatus = canUserChat(user);
  if (!chatStatus.allowed) {
    return new Response(
      JSON.stringify({ error: chatStatus.message, blocked: true }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });

  if (!conversation) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (conversation.userId !== user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check for merge fields and expand them
  const mergeFieldsInMessage = findMergeFields(message);
  let expandedMessage = message;
  let usedVariables: string[] = [];
  let missingVariables: string[] = [];

  if (mergeFieldsInMessage.length > 0) {
    const userVariables = await prisma.gtmVariable.findMany({
      where: { userId: user.id },
      select: { mergeField: true, value: true },
    });

    const expansion = expandMergeFields(message, userVariables);
    expandedMessage = expansion.expanded;
    usedVariables = expansion.usedVariables;
    missingVariables = expansion.missingVariables;
  }

  // Save user message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  // Update conversation preview and start AI title generation if first message
  const isFirstMessage = !conversation.firstMessagePreview;

  if (isFirstMessage) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { firstMessagePreview: message.substring(0, 100) },
    });

    // Fire-and-forget title generation
    generateChatTitle(message)
      .then(async (generatedTitle) => {
        if (generatedTitle && generatedTitle !== "New Conversation") {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { title: generatedTitle },
          });
        }
      })
      .catch((err) => {
        console.error("[Title] Error generating title:", err);
      });
  }

  // Build conversation history if needed
  let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (!conversation.chatbaseConversationId) {
    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    chatbaseHistory = await Promise.all(
      history.slice(0, -1).map(async (msg: { role: string; content: string }) => {
        let content = msg.content;
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

  // Create the SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial event with expansion info
        if (mergeFieldsInMessage.length > 0) {
          controller.enqueue(
            encoder.encode(
              `event: expansion\ndata: ${JSON.stringify({
                originalMessage: message,
                expandedMessage,
                usedVariables,
                missingVariables,
              })}\n\n`
            )
          );
        }

        // Send poll for title event if first message
        if (isFirstMessage) {
          controller.enqueue(
            encoder.encode(`event: poll_title\ndata: true\n\n`)
          );
        }

        // Get response from Chatbase (non-streaming)
        const chatbaseResult = await sendToChatbase(
          expandedMessage,
          conversation.chatbaseConversationId || undefined,
          chatbaseHistory
        );

        const fullResponse = chatbaseResult.response;
        const chatbaseConvId = chatbaseResult.conversationId;

        // Simulate streaming by sending chunks with small delays
        for (const chunk of chunkResponse(fullResponse)) {
          controller.enqueue(
            encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`)
          );
          // Small delay to simulate streaming (10-30ms per chunk)
          await new Promise(resolve => setTimeout(resolve, 15));
        }

        // Update conversation with Chatbase ID if we got one
        if (chatbaseConvId && !conversation.chatbaseConversationId) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { chatbaseConversationId: chatbaseConvId },
          });
        }

        // Save the complete assistant message
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "ASSISTANT",
            content: fullResponse,
          },
        });

        // Update conversation stats
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            messageCount: { increment: 2 },
            lastMessageAt: new Date(),
          },
        });

        // Send completion event with message metadata
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              messageId: assistantMessage.id,
              createdAt: assistantMessage.createdAt,
            })}\n\n`
          )
        );

        controller.close();
      } catch (error) {
        console.error("Error streaming from Chatbase:", error);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: "Failed to get response from AI" })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
