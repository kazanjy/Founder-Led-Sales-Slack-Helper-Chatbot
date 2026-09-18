import { openai } from "@/lib/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { WEB_TOOLS, getToolDefinitions } from "./tools";
import type { ToolContext } from "@/lib/agents/shared/types";

/**
 * Agent loop for the unified WEB agent — the one behind the chat
 * page's "Agent mode" toggle. Mirrors runGtmAgent's shape but:
 *
 *   - Carries the broader system prompt: the union of routing rules
 *     across the three Slack agents (per-deal, per-coaching-session,
 *     pipeline-wide, generic FLS via playbook RAG, whole-account
 *     context).
 *   - Uses the composed WEB_TOOLS registry so the model can reach
 *     every tool the three Slack agents expose.
 *
 * Conversation history comes in pre-formatted as ChatCompletionMessage
 * params (caller is responsible for converting from DB rows). The
 * agent does NOT persist messages — the route handler does that
 * after the call returns so it can write the tool trace alongside.
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
      ? `\n\nSELLER CONTEXT — this is the founder's own positioning. Lean on it for voice and to align recommendations with how they actually pitch:\n` +
        (seller.valueProp100w ? `\nValue prop (100w):\n${seller.valueProp100w}\n` : "") +
        (seller.narrative ? `\nSales narrative:\n${seller.narrative}\n` : "")
      : "";
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");
  const linkBlock = `\n\nDEEP LINKS — your reply renders as markdown in the web app. Emit inline markdown links so the founder can jump straight to the relevant page. Use IDs returned by your tools; never invent them.\n\n  • Specific deal mentioned → link first mention to [<deal name or company>](${appBase}/deals/<dealId>). If multiple deals appear, link each on its first mention.\n  • Pipeline-level answer (listPipeline / getPipelineSummary / getDealsLikelyToClose / getDealsNeedingHelp / getUpcomingDealActivity) → end with [Open pipeline in Mikey ↗](${appBase}/deals).\n  • Specific coaching session referenced → [<session title> — <YYYY-MM-DD>](${appBase}/coaching-history?session=<sessionId>).\n\nIf the answer is generic, skip the inline links — don't bolt one on.`;
  return `${BASE_SYSTEM_PROMPT}${sellerBlock}${linkBlock}`;
}

const BASE_SYSTEM_PROMPT = `You are Mikey, an AI-powered founder-led-sales coach. You're the founder's general-purpose agent in the web app — you handle questions about specific deals, the pipeline, coaching sessions, GTM strategy, and generic founder-led-sales practice.

You have read access to: the founder's deals (stage, status, value, participants, timeline entries, health analysis, upcoming meetings) and the cross-deal pipeline; their coaching sessions, goals, tasks, GTM maturity stage + assessment, and sales metrics; their GTM artifacts (sales narrative, ICP, discovery questions, first-call checklist, cold-call scripts, objection library, sales deck); and the Founder-Led Sales playbook (Mikey's underlying RAG knowledge base) via searchFounderLedSalesPlaybook.

ROUTING DECISIONS — read these carefully, they're the whole point of this surface:

1. Generic founder-led-sales questions ("what's MEDDICC?", "how does outbound work for PLG?", "when should I hire a sales leader?") → call searchFounderLedSalesPlaybook ONCE and answer. Don't call personal-data tools.

2. Questions clearly anchored in THEIR data ("what's our ARR?", "what's our value prop?", "what's our ICP?") → call the matching personal-data tool directly. Don't waste a playbook call.

3. Hybrid questions ("how should I pitch given our positioning?", "how do I handle pricing objections in our context?") → personal-data tool first, then optionally the playbook, then synthesize.

4. State / orientation ("what should I focus on this week?", "where are things at?") → getCoachingState (composite). Don't chain individual coaching tools.

5. Maturity / self-report ("what's our ICP/pricing/hiring story", "what gaps did we flag in our GTM") → getMaturityAssessment ONCE. Returns the full 56-Q&A with current stage. Don't pair with getMaturityStage.

6. Whole-account / strategic ("state of our GTM", "audit our positioning", "what should we focus on", "what's holding us back") → getFullAccountContext ONCE and answer from the payload. Includes narrative + value props + maturity assessment + readiness + coaching corpus + metrics + collateral library index. DO NOT chain other tools — the payload already contains everything they'd return.

6b. Uploaded collateral / specific documents ("what does our order form say", "find the case study about X", "pull the pricing terms from the MSA") → searchCollateral with the user's query. Matches asset name / description / extracted text against uploaded PDFs and .docx in the account's Collateral Library. Prefer this over searchFounderLedSalesPlaybook when the user is asking about THEIR OWN uploaded material.

7. Specific deal ("what's the status with Acme?", "what's next on MongoDB?") → findDeal → getDealCore (and dedicated tools as needed). Pick the top candidate ONLY if confidence is "high"; otherwise ask which one.

8. Specific coaching session ("summarize last session", "what did we agree on Tuesday?") → findCoachingSession → getCoachingSession / summarizeCoachingSession. Same high-confidence rule.

9. Pipeline / cross-deal (no specific deal named) — pick by intent:
   - "What's likely to close?" → getDealsLikelyToClose
   - "What's at risk / stalled / needs help?" → getDealsNeedingHelp
   - "Pipeline by stage / forecast" → getPipelineSummary
   - "Meetings this week" → getUpcomingDealActivity
   - "Show me deals where X" → listPipeline with filters
   Don't chain pipeline tools — pick the one whose intent matches.

GROUND RULES:

- Never invent tool arguments or IDs. Only use values returned by tools in this conversation.
- If a tool returns { error: ... }, surface it cleanly. If the founder hasn't authored their narrative or assessment, just answer with the playbook and note that adding the missing piece would personalize next time.
- Mutating tools (addCoachingNote, addTimelineEntry, draftFollowUpEmail when sent vs drafted) — confirm intent BEFORE calling unless the user was explicit ("jot down X", "log Y"). After calling, say what changed.
- Default to terse. If the playbook tool returns a long answer, trim to the part that actually answered the question.
- Format final answers as markdown — paragraphs, bullets, **bold**, and the inline deep links described below. The chat renders markdown directly.

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

export interface AgentStreamCallbacks {
  /**
   * Fired BEFORE each tool call is dispatched. Lets the UI show
   * "Calling getDealCore…" indicators while the agent is in
   * tool-using mode. Optional — no-op for buffered callers.
   */
  onToolCallStart?: (name: string, argsJson: string) => void;
  /**
   * Fired AFTER each tool call resolves with the result preview +
   * duration. Same trace entry that ends up in AgentResult.trace.
   */
  onToolCallEnd?: (entry: ToolCallTrace) => void;
  /**
   * Fired for each streaming token on the final assistant turn.
   * When omitted, the final turn is fetched buffered and the full
   * reply is returned in AgentResult.reply.
   */
  onTextChunk?: (chunk: string) => void;
}

export async function runWebAgent(
  opts: {
    userId: string;
    userMessage: string;
    conversationHistory?: ChatCompletionMessageParam[];
  },
  cbs: AgentStreamCallbacks = {}
): Promise<AgentResult> {
  const userRow = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { accountId: true },
  });
  const ctx: ToolContext = { userId: opts.userId, accountId: userRow?.accountId ?? null };
  const trace: ToolCallTrace[] = [];
  const seller = await loadSellerContext(opts.userId);
  const systemPrompt = buildSystemPrompt(seller);
  console.log(
    `[web-agent] seller context — narrative=${seller.narrative.length}c valueProp100w=${seller.valueProp100w.length}c, tools=${Object.keys(WEB_TOOLS).length}`
  );
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(opts.conversationHistory ?? []),
    { role: "user", content: opts.userMessage },
  ];

  // Stream a chat completion and return the assembled string. Token
  // chunks are forwarded to cbs.onTextChunk as they arrive. Used for
  // the final assistant turn so the UI gets tokens-as-typed instead
  // of waiting for the full reply.
  const streamFinalResponse = async (): Promise<string> => {
    if (!cbs.onTextChunk) {
      // No streaming callback — fall back to buffered fetch.
      const r = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages,
      });
      return r.choices[0].message.content?.trim() || "";
    }
    const stream = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages,
      stream: true,
    });
    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        cbs.onTextChunk(delta);
      }
    }
    return full.trim();
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Tool-using turns stay buffered. We only know whether the model
    // wants to call a tool after the response lands, and tools can't
    // run mid-stream anyway.
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages,
      tools: getToolDefinitions(),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Final turn — the model returned text instead of a tool call.
      // If a streaming callback was supplied, re-issue this turn with
      // streaming so the UI gets tokens incrementally. Otherwise the
      // already-buffered content is the reply.
      if (cbs.onTextChunk) {
        const streamed = await streamFinalResponse();
        return {
          reply: streamed || msg.content?.trim() || "(no reply produced)",
          trace,
          turns: turn + 1,
          hitTurnCap: false,
        };
      }
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
      cbs.onToolCallStart?.(name, argsJson);
      const startedAt = Date.now();
      const entry = WEB_TOOLS[name];
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
      const traceEntry: ToolCallTrace = { name, argsJson, durationMs, resultPreview: preview, error: errorMessage };
      trace.push(traceEntry);
      cbs.onToolCallEnd?.(traceEntry);
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
  const finalText = await streamFinalResponse();
  return {
    reply: finalText || "(no reply produced after turn cap)",
    trace,
    turns: MAX_TURNS,
    hitTurnCap: true,
  };
}
