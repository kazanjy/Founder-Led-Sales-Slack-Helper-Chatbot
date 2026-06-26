import { openai } from "@/lib/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { COACHING_TOOLS, getToolDefinitions, type ToolContext } from "./tools";

/**
 * Agent loop for the per-account coaching agent (phase 1).
 *
 * Takes a userId + a user message, runs a tool-use loop against
 * gpt-5.5 with the coaching tool registry, returns the final
 * assistant text plus a trace of every tool call. Caps at MAX_TURNS
 * to bound runaway behavior + cost. Mirrors src/lib/agents/deals/run.ts
 * — the two will fold into a single GTM agent once both surfaces are
 * stable.
 */

export const MAX_TURNS = 8;

async function loadSellerContext(userId: string): Promise<{
  narrative: string;
  valueProp100w: string;
}> {
  const [narrativeRow, vp100Row] = await Promise.all([
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_100W" },
      select: { value: true },
    }),
  ]);
  return {
    narrative: (narrativeRow?.value || "").trim(),
    valueProp100w: (vp100Row?.value || "").trim(),
  };
}

function buildSystemPrompt(seller: { narrative: string; valueProp100w: string }): string {
  const sellerBlock =
    seller.narrative || seller.valueProp100w
      ? `\n\nSELLER CONTEXT — this is the founder's own positioning. Use it to ground voice and align recommendations with the way they actually pitch:\n` +
        (seller.valueProp100w ? `\nValue prop (100w):\n${seller.valueProp100w}\n` : "") +
        (seller.narrative ? `\nSales narrative:\n${seller.narrative}\n` : "")
      : "";
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");
  const linkBlock = `\n\nSESSION DEEP LINKS — when your answer references one specific coaching session (you cited it, summarized it, pulled notes from it, etc.), include an inline markdown link to it on FIRST mention so the founder can jump straight to it:\n\n  [<session title> — <YYYY-MM-DD>](${appBase}/coaching-history?session=<sessionId>)\n\nUse the sessionId returned by your tools — never invent one. If the answer spans multiple sessions, link each one inline. If the answer is general (no specific session), skip the link — the Slack reply already has a generic "Open Coaching" link at the top.`;
  return `${BASE_SYSTEM_PROMPT}${sellerBlock}${linkBlock}`;
}

const BASE_SYSTEM_PROMPT = `You are Mikey, a sales coach answering questions about a founder's coaching practice via tool calls.

You have read access to their coaching sessions, goals, tasks, GTM maturity stage, and sales metrics. You can append notes to a live session.

GROUND RULES:

1. Always call findCoachingSession first when the user references a specific session by name, date, or vibe. Pick the top candidate ONLY if confidence is "high"; otherwise ask which one.
2. Prefer many small tool calls over one giant one — answer FROM the data, don't ask for a raw summary tool.
3. Answer the question that was asked. If the user asks "what active goals do we have", don't volunteer next-best-action.
4. Never invent sessionIds, goalIds, or taskIds — only use ones returned by tools in this conversation.
5. addCoachingNote MUTATES state. Confirm with the user BEFORE calling unless they were explicit ("jot down that X", not "we should probably remember Y"). After calling, tell them what was written.
6. Format final answers for Slack: short paragraphs, bullets where useful, never wall-of-text. No markdown headers (Slack renders them weird). Bold via *asterisks* not **double**.
7. If a tool returns { error: ... }, surface the error to the user — don't pretend it worked.

HIGH-LEVERAGE TOOL ROUTING:

— "Where did we leave off" / "what's the state of things" / "what's next" / "catch me up" →
  Call whereDidWeLeaveOff ONCE. It returns the most recent session + active goals + Up Next queue + maturity stage in a single shot. Don't chain individual tools for this.

— "Summarize the last session" / "write up takeaways" / "what were the decisions" →
  Call findCoachingSession (or just take the most recent), then summarizeCoachingSession. Follow the directive it returns — 4 sections, ~300 words, no preamble.

— "What's our ARR" / "how many customers" / specific metric →
  Call getLatestSalesMetrics with metricNames filter. Report the latest value + the delta vs. prior session.

— "Did we ever talk about X" / "when did we decide Y" →
  Call searchCoachingHistory. Surface the snippet + which session it came from.

— "What goals are active" / "what's done" / "what's stalled" →
  Call getCoachingGoalsAndTasks with the right scope ('active' is the default).

— "Pull together themes across all our coaching" / "how has my thinking evolved" / "what have we worked on over time" / "summarize everything we've done in coaching" →
  Call getFullCoachingHistory ONCE — it returns every session's notes + every goal/task + the queue + maturity + metrics in one payload. Reach for it when the question genuinely spans the whole corpus; don't chain it with other tools. Leave includeTranscripts off unless the user wants verbatim dialogue.

Today's date is ${new Date().toISOString().slice(0, 10)}.`;

export interface ToolCallTrace {
  name: string;
  argsJson: string;
  durationMs: number;
  resultPreview: string;
  error?: string;
}

export interface AgentResult {
  reply: string;
  trace: ToolCallTrace[];
  turns: number;
  hitTurnCap: boolean;
}

export async function runCoachingAgent(opts: {
  userId: string;
  userMessage: string;
  conversationHistory?: ChatCompletionMessageParam[];
}): Promise<AgentResult> {
  const ctx: ToolContext = { userId: opts.userId };
  const trace: ToolCallTrace[] = [];
  const seller = await loadSellerContext(opts.userId);
  const systemPrompt = buildSystemPrompt(seller);
  console.log(
    `[coaching-agent] seller context — narrative=${seller.narrative.length}c valueProp100w=${seller.valueProp100w.length}c`
  );
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(opts.conversationHistory ?? []),
    { role: "user", content: opts.userMessage },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages,
      tools: getToolDefinitions(),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        reply: msg.content?.trim() || "(no reply produced)",
        trace,
        turns: turn + 1,
        hitTurnCap: false,
      };
    }

    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      const argsJson = call.function.arguments || "{}";
      const startedAt = Date.now();
      const entry = COACHING_TOOLS[name];
      let resultPayload: unknown;
      let errorMessage: string | undefined;
      if (!entry) {
        resultPayload = { error: `Unknown tool: ${name}` };
        errorMessage = "unknown tool";
      } else {
        try {
          const args = JSON.parse(argsJson);
          resultPayload = await entry.handler(args, ctx);
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
          resultPayload = { error: errorMessage };
        }
      }
      const durationMs = Date.now() - startedAt;
      const preview = (() => {
        try {
          const s = JSON.stringify(resultPayload);
          return s.length > 300 ? s.substring(0, 300) + "…" : s;
        } catch {
          return String(resultPayload);
        }
      })();
      trace.push({ name, argsJson, durationMs, resultPreview: preview, error: errorMessage });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(resultPayload),
      });
    }
  }

  messages.push({
    role: "user",
    content: "(Turn cap reached. Stop calling tools and give the best answer you can with what you have.)",
  });
  const final = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages,
  });
  return {
    reply: final.choices[0].message.content?.trim() || "(no reply produced after turn cap)",
    trace,
    turns: MAX_TURNS,
    hitTurnCap: true,
  };
}
