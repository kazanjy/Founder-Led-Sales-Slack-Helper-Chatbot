import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runCoachingAgent } from "@/lib/agents/coaching/run";

/**
 * POST /api/agents/coaching
 *
 * Phase 1 entry point for the coaching tool-using agent. Takes a
 * single user message, runs the loop against gpt-5.5 + the coaching
 * tool registry, returns the assistant reply plus a full tool-call
 * trace for debugging.
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
    const result = await runCoachingAgent({
      userId: user.id,
      userMessage: message,
      conversationHistory: Array.isArray(body.history) ? body.history : undefined,
    });
    const totalMs = Date.now() - startedAt;
    console.log(`[coaching-agent] ${user.id} turns=${result.turns} totalMs=${totalMs}`);
    return NextResponse.json({
      reply: result.reply,
      turns: result.turns,
      hitTurnCap: result.hitTurnCap,
      trace: result.trace,
      totalMs,
    });
  } catch (err) {
    console.error(`[coaching-agent] failed after ${Date.now() - startedAt}ms:`, err);
    return NextResponse.json({ error: "Agent failed" }, { status: 500 });
  }
}
