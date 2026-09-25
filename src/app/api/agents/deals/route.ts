import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runDealAgent } from "@/lib/agents/deals/run";

/**
 * POST /api/agents/deals
 *
 * Phase 1 entry point for the per-deal Mikey agent. Takes a single
 * user message, runs the tool-use loop against gpt-5.5 + the deal
 * tool registry, returns the assistant reply plus a trace of every
 * tool call (for debugging and to power Slack "thinking" status
 * messages later).
 *
 * Body: { message: string, history?: ChatCompletionMessageParam[] }
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const result = await runDealAgent({
      userId: user.id,
      userMessage: message,
      conversationHistory: Array.isArray(body.history) ? body.history : undefined,
    });
    const totalMs = Date.now() - startedAt;
    console.log(`[deal-agent] ${user.id} turns=${result.turns} totalMs=${totalMs}`);
    return NextResponse.json({
      reply: result.reply,
      turns: result.turns,
      hitTurnCap: result.hitTurnCap,
      trace: result.trace,
      totalMs,
    });
  } catch (err) {
    console.error(`[deal-agent] failed after ${Date.now() - startedAt}ms:`, err);
    return NextResponse.json({ error: "Agent failed" }, { status: 500 });
  }
}
