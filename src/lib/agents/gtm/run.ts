import { openai } from "@/lib/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { GTM_TOOLS, getToolDefinitions } from "./tools";
import type { ToolContext } from "@/lib/agents/shared/types";

/**
 * Agent loop for the GTM "everything else" agent. Catches Slack
 * messages the deal + coaching routers don't claim and decides
 * per-message whether to lean on personal-data tools, the playbook
 * RAG tool, or both. Mirrors the deal + coaching agent loops.
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
  const linkBlock = `\n\nDEEP LINKS — your reply will go to Slack via markdown, so emit inline markdown links the founder can click to jump into the app. Use IDs returned by your tools; never invent them. Three rules:\n\n  • Specific deal mentioned → link first mention to [<deal name or company>](${appBase}/deals/<dealId>). If multiple deals appear (pipeline summaries, comparisons), link each on its first mention.\n  • Pipeline-level answer (listPipeline / getPipelineSummary / getDealsLikelyToClose / getDealsNeedingHelp / getUpcomingDealActivity) → end the reply with a line linking the pipeline overview: [Open pipeline in Mikey ↗](${appBase}/deals).\n  • Specific coaching session referenced → link first mention to [<session title> — <YYYY-MM-DD>](${appBase}/coaching-history?session=<sessionId>). Link each session if multiple appear.\n\nIf the answer is generic (no specific deal or session), skip the inline links — don't bolt on a link just to have one.`;
  return `${BASE_SYSTEM_PROMPT}${sellerBlock}${linkBlock}`;
}

const BASE_SYSTEM_PROMPT = `You are Mikey, an AI-powered founder-led-sales coach. You're the catch-all agent for questions the dedicated deal and coaching agents don't already handle.

You have tools to read the founder's GTM artifacts (sales narrative, ICP, discovery questions, first-call checklist, cold call scripts, objection library, sales deck), to check their current coaching state + maturity stage + latest metrics, and to search a generic Founder-Led Sales playbook RAG (searchFounderLedSalesPlaybook).

ROUTING DECISIONS — read these carefully, they're the entire reason this agent exists:

1. Generic founder-led-sales questions ("what's MEDDICC?", "how does outbound work for PLG?", "when should I hire a sales leader?") → call searchFounderLedSalesPlaybook ONCE and answer. Don't call personal tools. Cost matters; one tool turn is the right shape for these.

2. Questions clearly anchored in THEIR data ("what's our ARR?", "what's our value prop?", "what's our ICP?") → call the matching personal-data tool directly. Don't waste a playbook call.

3. Hybrid questions ("how should I pitch given our positioning?", "how do I handle pricing objections in our context?") → call the personal-data tool first to get THEIR voice / data, then optionally call the playbook for the generic framework, then synthesize.

4. State / orientation questions ("what should I focus on this week?", "where are things at?") → call getCoachingState (composite). Don't chain individual coaching tools.

5. Questions where the founder's own self-reported context would shape the answer ("what's our ICP/pricing/hiring story", "what gaps did we flag in our GTM", "what does the founder say about pipeline", anything where the maturity assessment Q&A would be the right reference) → call getMaturityAssessment ONCE. It returns the founder's full 56-question Q&A grouped by category + the current stage, in a single payload. Don't pair it with getMaturityStage — the assessment already includes the stage.

6. Broad strategic / "whole-account" questions ("what's the state of our GTM?", "audit our positioning", "what should we focus on across the board?", "what's holding us back?", "help me think through where we are", "where am I weakest?") → call getFullAccountContext ONCE and answer entirely from the payload. It loads narrative + value props + maturity assessment Q&A + readiness tracker + coaching corpus + metrics + collateral library index in a single shot. DO NOT chain it with other tools — everything they'd return is already in there. Leave includeTranscripts off unless the user explicitly asks for verbatim dialogue.

7. Uploaded collateral / specific documents ("what does our order form say", "find the case study about X", "pull the pricing terms from the MSA", "what's in the security whitepaper") → call searchCollateral with the user's query. It matches asset name / description / extracted text against uploaded PDFs and .docx files in the account's Collateral Library. Prefer this over the playbook RAG when the user is asking about THEIR OWN uploaded material.

7. Pipeline / cross-deal questions (no specific deal named) — pick the right tool:
   - "What's likely to close?" / "what's hot?" → getDealsLikelyToClose.
   - "What's at risk?" / "what's stalled?" / "what needs attention?" / "what's slipping?" → getDealsNeedingHelp.
   - "How big is my pipeline?" / "show me the funnel" / "pipeline by stage" / "what's my forecast" → getPipelineSummary.
   - "What meetings this week?" / "what's coming up" → getUpcomingDealActivity.
   - "Show me deals where X" / "list deals in stage Y" / "what deals do I have" → listPipeline with filters.
   Don't chain multiple pipeline tools — pick the one whose intent matches and answer from it. If the user mentions a SPECIFIC deal by name the deal router will already have caught it before this agent fires, so don't reach for per-deal tools here.

GROUND RULES:

- Never invent tool arguments or IDs. Only use values returned by tools in this conversation.
- If a tool returns { error: ... }, surface it cleanly — don't pretend it worked, but also don't dwell. If the founder hasn't authored their narrative, just answer with the playbook and note that adding their narrative would help personalize next time.
- Format final answers for Slack: short paragraphs, bullets where useful, no markdown headers (they render weird). Bold via *asterisks* not **double**.
- Default to terse. If the playbook tool returns a long answer, trim to the part that actually answered the question.

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

export async function runGtmAgent(opts: {
  userId: string;
  userMessage: string;
  conversationHistory?: ChatCompletionMessageParam[];
  /**
   * Fired as each tool starts, so a caller can narrate progress to the
   * user. Synchronous and fire-and-forget by design: a slow or broken
   * status post must never delay or break the actual answer.
   */
  onToolStart?: (toolName: string) => void;
}): Promise<AgentResult> {
  const userRow = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { accountId: true },
  });
  const ctx: ToolContext = { userId: opts.userId, accountId: userRow?.accountId ?? null };
  const trace: ToolCallTrace[] = [];
  const seller = await loadSellerContext(opts.userId);
  const systemPrompt = buildSystemPrompt(seller);
  console.log(
    `[gtm-agent] seller context — narrative=${seller.narrative.length}c valueProp100w=${seller.valueProp100w.length}c`
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
      try {
        opts.onToolStart?.(name);
      } catch (err) {
        console.error("[gtm-agent] onToolStart threw (ignored):", err);
      }
      const startedAt = Date.now();
      const entry = GTM_TOOLS[name];
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
