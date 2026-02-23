import { NextRequest } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { streamFromChatbase } from "@/lib/chatbase/client";
import { expandMergeFields, findMergeFields } from "@/lib/default-gtm-variables";
import { generateChatTitle } from "@/lib/openai";

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
  const { message, attachments } = body;

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate attachments if provided
  const validAttachments = ["salesNarrative", "gtmAssessment", "discoveryQuestions", "firstCallChecklist"];
  const requestedAttachments: string[] = Array.isArray(attachments)
    ? attachments.filter((a: string) => validAttachments.includes(a))
    : [];

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

  // Check if attachments can be added (only once per conversation)
  const existingAttachments = conversation.attachmentsIncluded as string[] | null;
  const canAddAttachments = !existingAttachments?.length && requestedAttachments.length > 0;
  const isFirstMessage = !conversation.firstMessagePreview;
  let attachmentContent = "";

  // Fetch and prepend attachment content if this is the first time adding attachments
  if (canAddAttachments) {
    const attachmentParts: string[] = [];

    for (const attachmentId of requestedAttachments) {
      try {
        const content = await fetchAttachmentContent(user.id, attachmentId);
        if (content) {
          attachmentParts.push(`## ${content.title}\n\n${content.text}`);
        }
      } catch (err) {
        console.error(`[Attachments] Error fetching ${attachmentId}:`, err);
      }
    }

    if (attachmentParts.length > 0) {
      attachmentContent = `\n\n---\n\n**The following context was attached by the user to provide background:**\n\n${attachmentParts.join("\n\n---\n\n")}\n\n---`;
    }
  }

  // Append attachment content to the expanded message
  if (attachmentContent) {
    expandedMessage = expandedMessage + attachmentContent;
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

  // Update conversation metadata
  const updateData: Record<string, unknown> = {};
  if (isFirstMessage) {
    updateData.firstMessagePreview = message.substring(0, 100);
  }
  if (canAddAttachments) {
    updateData.attachmentsIncluded = requestedAttachments;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: updateData,
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

        // Stream from Chatbase with buffering for smoother display
        const chatbaseStream = streamFromChatbase(
          expandedMessage,
          conversation.chatbaseConversationId || undefined,
          chatbaseHistory
        );

        let fullResponse = "";
        let chatbaseConvId: string | undefined;
        let buffer = "";
        const MIN_CHUNK_SIZE = 15; // Buffer until we have at least this many chars

        // Helper to flush buffer to client
        const flushBuffer = () => {
          if (buffer) {
            controller.enqueue(
              encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: buffer })}\n\n`)
            );
            buffer = "";
          }
        };

        // Iterate through the async generator
        while (true) {
          const result = await chatbaseStream.next();
          if (result.done) {
            // Generator finished, flush remaining buffer and get return value
            flushBuffer();
            if (result.value && typeof result.value === "object") {
              chatbaseConvId = result.value.conversationId;
            }
            break;
          }

          // result.value is a text chunk
          const chunk = result.value;
          fullResponse += chunk;
          buffer += chunk;

          // Send buffer when it's large enough or contains sentence-ending punctuation
          if (buffer.length >= MIN_CHUNK_SIZE || /[.!?]\s*$/.test(buffer) || buffer.includes("\n")) {
            flushBuffer();
          }
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

// Helper to fetch attachment content
async function fetchAttachmentContent(
  userId: string,
  attachmentId: string
): Promise<{ title: string; text: string } | null> {
  switch (attachmentId) {
    case "salesNarrative": {
      const [narrativeVar, desc100, desc50, desc25] = await Promise.all([
        prisma.gtmVariable.findFirst({
          where: { userId, mergeField: "SALES_NARRATIVE" },
          select: { value: true },
        }),
        prisma.gtmVariable.findFirst({
          where: { userId, mergeField: "VALUE_PROP_100W" },
          select: { value: true },
        }),
        prisma.gtmVariable.findFirst({
          where: { userId, mergeField: "VALUE_PROP_50W" },
          select: { value: true },
        }),
        prisma.gtmVariable.findFirst({
          where: { userId, mergeField: "VALUE_PROP_25W" },
          select: { value: true },
        }),
      ]);

      if (!narrativeVar?.value) return null;

      let text = `### Full Sales Narrative\n\n${narrativeVar.value}`;
      if (desc100?.value) text += `\n\n### 100-Word Description\n\n${desc100.value}`;
      if (desc50?.value) text += `\n\n### 50-Word Description\n\n${desc50.value}`;
      if (desc25?.value) text += `\n\n### 25-Word Tagline\n\n${desc25.value}`;

      return { title: "Sales Narrative", text };
    }

    case "gtmAssessment": {
      const assessment = await prisma.maturityAssessment.findFirst({
        where: { userId },
        orderBy: { completedAt: "desc" },
        include: {
          answers: {
            include: {
              question: {
                select: { category: true, globalOrder: true, question: true },
              },
            },
            orderBy: { question: { globalOrder: "asc" } },
          },
        },
      });

      if (!assessment || assessment.answers.length === 0) return null;

      // Group by category
      const categories: Record<string, Array<{ question: string; answer: string; order: number }>> = {};
      for (const answer of assessment.answers) {
        const cat = answer.question.category;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({
          question: answer.question.question,
          answer: answer.answer,
          order: answer.question.globalOrder,
        });
      }

      // Build text
      let text = "";
      const sortedCategories = Object.entries(categories).sort(
        (a, b) => (a[1][0]?.order || 0) - (b[1][0]?.order || 0)
      );
      for (const [catName, questions] of sortedCategories) {
        text += `### ${catName}\n\n`;
        for (const q of questions) {
          text += `**Q${q.order}: ${q.question}**\n${q.answer || "_Not answered_"}\n\n`;
        }
      }

      return { title: "GTM Assessment (Q&A)", text: text.trim() };
    }

    case "discoveryQuestions": {
      const variable = await prisma.gtmVariable.findFirst({
        where: { userId, mergeField: "DISCOVERY_QUESTIONS" },
        select: { value: true },
      });

      if (!variable?.value) return null;

      // Try to parse as JSON and format
      try {
        const data = JSON.parse(variable.value);
        let text = "";
        if (data.categories && Array.isArray(data.categories)) {
          for (const category of data.categories) {
            text += `### ${category.name}\n`;
            if (category.description) text += `${category.description}\n\n`;
            for (let i = 0; i < category.questions.length; i++) {
              const q = category.questions[i];
              text += `${i + 1}. ${q.primary}\n`;
              if (q.followUps?.length > 0) {
                for (const followUp of q.followUps) {
                  text += `   - ${followUp}\n`;
                }
              }
            }
            text += "\n";
          }
        }
        return { title: "Discovery Questions", text: text.trim() || variable.value };
      } catch {
        return { title: "Discovery Questions", text: variable.value };
      }
    }

    case "firstCallChecklist": {
      const variable = await prisma.gtmVariable.findFirst({
        where: { userId, mergeField: "FIRST_CALL_CHECKLIST" },
        select: { value: true },
      });

      if (!variable?.value) return null;
      return { title: "First Call Checklist", text: variable.value };
    }

    default:
      return null;
  }
}
