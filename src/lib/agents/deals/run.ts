import { openai } from "@/lib/openai";
import type {
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { DEAL_TOOLS, getToolDefinitions, type ToolContext } from "./tools";

/**
 * Agent loop for the per-deal Mikey agent (phase 1).
 *
 * Takes a userId + a user message, runs a tool-use loop against
 * gpt-5.5 with the deal tool registry, and returns the final assistant
 * text plus a trace of every tool call (for debugging + future Slack
 * "thinking" status messages). Caps at MAX_TURNS to bound runaway
 * behavior + cost.
 */

export const MAX_TURNS = 8;

const SYSTEM_PROMPT = `You are Mikey, a sales coach answering questions about a founder's specific deals via tool calls.

You have read access to the founder's deals: stage / status / dates / value / participants / timeline entries (calls, emails, notes) / Mikey Health analysis / upcoming meetings. You can also draft follow-up emails and log new entries.

GROUND RULES:

1. Always call findDeal first when the user mentions a deal by name. Pick the top candidate ONLY if confidence is "high" — if it's "medium" or "low" or there are multiple candidates, ask the user which one.
2. Prefer many small tool calls over one giant one. Synthesize the answer from structured tool results, don't ask for a raw summary tool.
3. Answer the question that was asked. If the user asks "who's on the deal", just answer that — don't volunteer next-best-action unless asked.
4. Never invent dealIds, entryIds, or participant ids. Only use ones returned by tools in this conversation.
5. addTimelineEntry mutates state. Confirm with the user BEFORE calling it unless they were explicit ("log a note saying X", not "I should probably log that"). After calling it, tell them what was written.
6. Format final answers for Slack: short paragraphs, bullets where useful, never wall-of-text. No markdown headers (Slack renders them weird). Bold via *asterisks* not **double**.
7. If a tool returns { error: ... }, surface the error to the user — don't pretend it worked.

SYNTHESIS FORMATS — when the user asks for one of these, gather the data via the read tools and write the answer in this exact structure:

— "Prep me for the meeting" / "Prep for next call" / similar →
  Call getDealCore + getRecentActivity + getParticipants + getHealthAndRisks + getUpcomingMeetings first.
  Then produce:
    *Likely state of mind* — one bullet per external stakeholder.
    *Top 2-3 outcomes* — what you want to accomplish in the meeting.
    *Questions to ask* — 3-5 specific questions.
    *Questions to expect* — 2-4 likely objections / questions back at you.
    *Smartest next-step ask* — one concrete proposal to land at the end.

— "Next best action" / "What should I do next on X" →
  Call getDealCore + getRecentActivity + getHealthAndRisks + getUpcomingMeetings first.
  Then produce one specific action, with: WHAT (the concrete move), WHY (the timeline evidence), HOW (who to contact, what to say — draft any message in full), and what a good response signals.

— "Summarize the call" / "What was discussed on X call" / "Remind me what we talked about" →
  Use summarizeCall, NOT getRecentActivity + getCallDetail. It handles "most recent", "first week of June", or a specific entryId in one call. Then write 4-6 bullets per its directive.

— Email drafts go through draftFollowUpEmail (which returns the right context). Output exactly: 'Subject: ...' line, blank line, body. Under 200 words.

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

export async function runDealAgent(opts: {
  userId: string;
  userMessage: string;
  conversationHistory?: ChatCompletionMessageParam[];
}): Promise<AgentResult> {
  const ctx: ToolContext = { userId: opts.userId };
  const trace: ToolCallTrace[] = [];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
      // Final answer — model chose not to call any more tools.
      return {
        reply: msg.content?.trim() || "(no reply produced)",
        trace,
        turns: turn + 1,
        hitTurnCap: false,
      };
    }

    // Push the assistant's tool-call message so the next turn knows
    // what tools were called.
    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    // Execute each tool call sequentially. Parallel would be faster
    // but harder to debug + most tool sequences are inherently
    // sequential (findDeal → getX).
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      const argsJson = call.function.arguments || "{}";
      const startedAt = Date.now();
      const entry = DEAL_TOOLS[name];
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

  // Hit the turn cap. Ask the model for whatever it has.
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
