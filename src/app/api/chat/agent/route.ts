import { NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runWebAgent } from "@/lib/agents/web/run";
import { generateChatTitle } from "@/lib/openai";

/**
 * POST /api/chat/agent
 *
 * SSE-streaming entry point for the unified web agent. Mirrors the
 * shape of /api/conversations/[id]/messages/stream so the chat page
 * can reuse its existing SSE consumer:
 *
 *   event: tool_call_start  data: { name, argsJson }
 *   event: tool_call_end    data: { name, argsJson, durationMs,
 *                                   resultPreview, error? }
 *   event: chunk            data: { text: "..." }
 *   event: done             data: { messageId, createdAt, turns,
 *                                   hitTurnCap, trace, pollForTitle }
 *   event: error            data: { error: "..." }
 *
 * Sales narrative is loaded server-side into the agent's system
 * prompt by runWebAgent — no per-request opt-in needed.
 *
 * Body: { conversationId: string, message: string }
 */

export const maxDuration = 300;

const HISTORY_LIMIT = 20;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const chatStatus = canUserChat(user);
  if (!chatStatus.allowed) {
    return new Response(
      JSON.stringify({ error: chatStatus.message, blocked: true }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await request.json();
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!conversationId || !message) {
    return new Response(
      JSON.stringify({ error: "conversationId and message are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
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

  // Persist the user message up front so refresh-mid-flight still
  // shows it in the timeline.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  const isFirstMessage = !conversation.firstMessagePreview;
  if (isFirstMessage) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { firstMessagePreview: message.substring(0, 100) },
    });
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

  const priorRows = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
  });
  const priorHistory: ChatCompletionMessageParam[] = priorRows
    .filter((m, idx) => !(idx === priorRows.length - 1 && m.role === "USER"))
    .map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const result = await runWebAgent(
          {
            userId: user.id,
            userMessage: message,
            conversationHistory: priorHistory.length > 0 ? priorHistory : undefined,
          },
          {
            onToolCallStart: (name, argsJson) => {
              send("tool_call_start", { name, argsJson });
            },
            onToolCallEnd: (entry) => {
              send("tool_call_end", entry);
            },
            onTextChunk: (text) => {
              send("chunk", { text });
            },
          }
        );

        // Persist the assistant message with the trace as metadata so
        // it re-renders on reload and feeds the collapsible disclosure.
        const assistantRow = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "ASSISTANT",
            content: result.reply,
            metadata: {
              agent: "web",
              turns: result.turns,
              hitTurnCap: result.hitTurnCap,
              trace: result.trace,
            },
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            messageCount: { increment: 2 },
            lastMessageAt: new Date(),
          },
        });

        const totalMs = Date.now() - startedAt;
        console.log(
          `[web-agent] user=${user.id} convo=${conversation.id} turns=${result.turns} tools=${result.trace.length} totalMs=${totalMs}${result.hitTurnCap ? " hitTurnCap" : ""}`
        );

        send("done", {
          messageId: assistantRow.id,
          createdAt: assistantRow.createdAt,
          turns: result.turns,
          hitTurnCap: result.hitTurnCap,
          trace: result.trace,
          pollForTitle: isFirstMessage,
          agent: "web",
        });

        controller.close();
      } catch (err) {
        console.error(`[web-agent] failed after ${Date.now() - startedAt}ms:`, err);
        send("error", { error: err instanceof Error ? err.message : "Agent failed" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
