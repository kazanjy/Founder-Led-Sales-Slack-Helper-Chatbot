import { NextRequest } from "next/server";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { streamFromChatbase } from "@/lib/chatbase/client";
import { streamFromOpenAI } from "@/lib/openai-chat";
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
  const validAttachments = ["salesNarrative", "gtmAssessment", "discoveryQuestions", "firstCallChecklist", "coachingHistory"];
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

  // Track last active time for web interaction (non-blocking)
  prisma.user.update({
    where: { id: user.id },
    data: { lastActiveAt: new Date() },
  }).catch((err: unknown) => console.warn("Failed to update lastActiveAt:", err));

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

  // Save user message (with attachment content if included, so user can see what was sent)
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: expandedMessage,
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

  // Determine conversation mode. When the combined message +
  // attachment content exceeds Chatbase's effective capacity, auto-
  // promote to DIRECT so the full context reaches GPT in one
  // window instead of being truncated or aggressively chunked.
  const AUTO_FLIP_CHAR_THRESHOLD = 12000;
  let isDirectMode = conversation.mode === "DIRECT";
  if (
    !isDirectMode &&
    expandedMessage.length > AUTO_FLIP_CHAR_THRESHOLD
  ) {
    console.log(
      `[stream] Auto-flipping conversation ${conversation.id} to DIRECT ` +
        `(message length ${expandedMessage.length} > ${AUTO_FLIP_CHAR_THRESHOLD})`
    );
    isDirectMode = true;
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { mode: "DIRECT" },
    });
  }

  // Fetch user's prompt guidance for injection into AI context
  const promptGuidance = user.promptGuidance || "";

  // Build conversation history
  let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  let directHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

  if (isDirectMode) {
    // Direct mode: load ALL messages for full context (GPT handles large context windows)
    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    directHistory = await Promise.all(
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
  } else if (!conversation.chatbaseConversationId) {
    // Chatbase mode without existing conversation: send recent history
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

        let fullResponse = "";
        let buffer = "";
        const MIN_CHUNK_SIZE = 15;

        // Helper to flush buffer to client
        const flushBuffer = () => {
          if (buffer) {
            controller.enqueue(
              encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: buffer })}\n\n`)
            );
            buffer = "";
          }
        };

        if (isDirectMode) {
          // ===== DIRECT MODE: Stream from OpenAI GPT =====
          // If user has prompt guidance, inject it as a system message in history
          if (promptGuidance) {
            directHistory.unshift({
              role: "system",
              content: `## User's Prompt Guidance\nThe user has provided the following guidance for how you should respond. Follow these instructions:\n\n${promptGuidance}`,
            });
          }
          const openaiStream = streamFromOpenAI(expandedMessage, directHistory);

          while (true) {
            const result = await openaiStream.next();
            if (result.done) {
              flushBuffer();
              break;
            }

            const chunk = result.value;
            fullResponse += chunk;
            buffer += chunk;

            if (buffer.length >= MIN_CHUNK_SIZE || /[.!?]\s*$/.test(buffer) || buffer.includes("\n")) {
              flushBuffer();
            }
          }
        } else {
          // ===== CHATBASE MODE: Stream from Chatbase (existing behavior) =====
          // If user has prompt guidance, prepend it as a user→assistant exchange in history
          if (promptGuidance) {
            chatbaseHistory.unshift(
              { role: "user", content: `[System: The user has set the following prompt guidance for tone and style. Follow these instructions in all responses:]\n\n${promptGuidance}` },
              { role: "assistant", content: "Understood — I'll follow your prompt guidance in all my responses." },
            );
          }
          const chatbaseStream = streamFromChatbase(
            expandedMessage,
            conversation.chatbaseConversationId || undefined,
            chatbaseHistory
          );

          let chatbaseConvId: string | undefined;

          while (true) {
            const result = await chatbaseStream.next();
            if (result.done) {
              flushBuffer();
              if (result.value && typeof result.value === "object") {
                chatbaseConvId = result.value.conversationId;
              }
              break;
            }

            const chunk = result.value;
            fullResponse += chunk;
            buffer += chunk;

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
              ...(attachmentContent ? { savedUserMessage: expandedMessage } : {}),
            })}\n\n`
          )
        );

        controller.close();
      } catch (error) {
        console.error(`Error streaming from ${isDirectMode ? "OpenAI" : "Chatbase"}:`, error);
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

    case "coachingHistory": {
      const sessions = await prisma.coachingSession.findMany({
        where: { userId },
        orderBy: { sessionDate: "asc" },
        select: { title: true, sessionDate: true, notes: true, transcript: true },
      });

      if (sessions.length === 0) return null;

      let text = "";
      for (const session of sessions) {
        const date = session.sessionDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        text += `### Session: ${session.title} — ${date}\n\n`;
        text += `#### Notes\n${session.notes}\n\n`;
        if (session.transcript) {
          text += `#### Call Transcript\n${session.transcript}\n\n`;
        }
        text += "---\n\n";
      }

      return { title: `Coaching History (${sessions.length} sessions)`, text: text.trim() };
    }

    default:
      return null;
  }
}
