import { NextRequest, NextResponse } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getCurrentUser, canUserChat } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runWebAgent } from "@/lib/agents/web/run";
import { generateChatTitle } from "@/lib/openai";

/**
 * POST /api/chat/agent
 *
 * The unified "Agent mode" entry point for the main /chat surface.
 * Runs runWebAgent against the full tool surface (deal + coaching +
 * GTM + playbook), persists user + assistant messages with the
 * tool-call trace, and returns the reply.
 *
 * Sales narrative is loaded server-side into the agent's system
 * prompt via runWebAgent.loadSellerContext — no per-request opt-in
 * needed; the narrative is on by default for every agent run.
 *
 * Body: { conversationId: string, message: string }
 */

export const maxDuration = 300;

const HISTORY_LIMIT = 20;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const chatStatus = canUserChat(user);
    if (!chatStatus.allowed) {
      return NextResponse.json(
        { error: chatStatus.message, blocked: true },
        { status: 403 }
      );
    }

    const body = await request.json();
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!conversationId || !message) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (conversation.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Save the user message first so refreshes show it even if the
    // agent run errors mid-flight.
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: message,
      },
    });

    // Kick off title generation on the first message — same pattern
    // as the other message endpoints.
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

    // Pull the most recent N messages BEFORE the one we just wrote
    // for the agent's conversation context. The agent injects the
    // system prompt itself.
    const priorRows = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: HISTORY_LIMIT,
    });
    const priorHistory: ChatCompletionMessageParam[] = priorRows
      // Drop the just-saved user row — runWebAgent appends it.
      .filter((m, idx) => !(idx === priorRows.length - 1 && m.role === "USER"))
      .map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      }));

    const result = await runWebAgent({
      userId: user.id,
      userMessage: message,
      conversationHistory: priorHistory.length > 0 ? priorHistory : undefined,
    });

    // Persist the assistant message with the tool-call trace as
    // metadata so the chat UI can render the disclosure beneath it.
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

    return NextResponse.json({
      message: {
        id: assistantRow.id,
        role: "ASSISTANT",
        content: result.reply,
        createdAt: assistantRow.createdAt,
        metadata: {
          agent: "web",
          turns: result.turns,
          hitTurnCap: result.hitTurnCap,
          trace: result.trace,
        },
      },
      pollForTitle: isFirstMessage,
      totalMs,
    });
  } catch (err) {
    console.error(`[web-agent] failed after ${Date.now() - startedAt}ms:`, err);
    return NextResponse.json({ error: "Agent failed" }, { status: 500 });
  }
}
