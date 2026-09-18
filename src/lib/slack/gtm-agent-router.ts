import type { WebClient } from "@slack/web-api";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { sendSlackMessage, getThreadMessages } from "./client";
import { markdownToSlack } from "./markdown";
import { appendFileContext } from "./file-context";
import { type BurstMessage } from "./burst-context";
import { runGtmAgent } from "@/lib/agents/gtm/run";
import { AgentStatus } from "./agent-status";

/**
 * Default-everything-else Slack router. Catches messages the deal +
 * coaching routers don't claim and hands them to the GTM agent
 * instead of the legacy Chatbase send path. The GTM agent has the
 * Chatbase RAG corpus available as a TOOL
 * (searchFounderLedSalesPlaybook), so a generic founder-led-sales
 * question resolves to one tool call against the same playbook
 * content — just routed through the agent loop now.
 *
 * As of A1, attached file text is extracted up front in events.ts
 * and passed in as `fileContext`; this router folds it into the
 * agent message so file messages get full personal-data/tool
 * context instead of falling to legacy Chatbase.
 */

const MAX_THREAD_HISTORY = 12;

export async function tryHandleWithGtmAgent(opts: {
  speakerUserId: string;
  text: string;
  // Extracted text from any attached files (empty when none).
  fileContext?: string;
  client: WebClient;
  channel: string;
  threadTs: string | undefined;
  botUserId: string | null;
  messageTs: string;
  threadRootTs: string | undefined;
  // Rapid-fire channel notes preceding this invocation — see
  // lib/slack/burst-context.
  priorBurst?: BurstMessage[];
}): Promise<boolean> {
  const { speakerUserId, text, fileContext, client, channel, threadTs, botUserId, messageTs, threadRootTs } = opts;
  const priorBurst = opts.priorBurst || [];

  try {
    const cleaned = stripSlackMentions(text || "").trim();
    // Nothing to answer if there's neither a message nor file text.
    if (!cleaned && !(fileContext || "").trim()) return false;

    // Channel-claim swap — same as deal + coaching routers.
    const channelClaim = await prisma.channelClaim.findUnique({
      where: { slackChannelId: channel },
      select: { claimedByUserId: true },
    });
    const contextUserId = channelClaim?.claimedByUserId || speakerUserId;

    // Thread history loaded BEFORE we decide to handle — the agent
    // needs prior context to interpret follow-ups correctly.
    let priorThread: Array<{ role: "user" | "assistant"; text: string }> = [];
    if (threadRootTs && threadRootTs !== messageTs) {
      try {
        const raw = await getThreadMessages(client, channel, threadRootTs);
        for (const m of raw) {
          if (m.ts === messageTs) continue;
          const txt = stripSlackMentions(m.text || "").trim();
          if (!txt) continue;
          const role = m.bot_id || (botUserId && m.user === botUserId) ? "assistant" : "user";
          priorThread.push({ role, text: txt });
        }
        if (priorThread.length > MAX_THREAD_HISTORY) {
          priorThread = priorThread.slice(-MAX_THREAD_HISTORY);
        }
      } catch (err) {
        console.error("[slack→gtm-agent] failed to load thread history:", err);
      }
    }

    console.log(
      `[slack→gtm-agent] user=${contextUserId} text="${cleaned.substring(0, 140)}" routing to GTM agent`
    );

    const conversationHistory: ChatCompletionMessageParam[] = [
      ...priorBurst.map((b) => ({
        role: "user" as const,
        content: `(just said in the channel moments earlier) ${b.text}`,
      })),
      ...priorThread.map((m) => ({ role: m.role, content: m.text })),
    ];
    // Narrate slow tool work in-thread. Some turns (a candidate
    // assessment is a PDL enrich plus two model passes) run long enough
    // that silence reads as a broken bot.
    // Same threadTs the answer uses, so the status and the reply can't
    // land in different places.
    const status = new AgentStatus(client, channel, threadTs);
    const result = await runGtmAgent({
      userId: contextUserId,
      userMessage: appendFileContext(cleaned, fileContext),
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
      onToolStart: (tool) => status.announce(tool),
    });

    await status.settle();
    const slackReply = markdownToSlack(result.reply);
    await sendSlackMessage(client, channel, slackReply, threadTs);

    console.log(
      `[slack→gtm-agent] user=${contextUserId} turns=${result.turns} tools=${result.trace.length}${result.hitTurnCap ? " hitTurnCap" : ""}`
    );
    return true;
  } catch (err) {
    console.error("[slack→gtm-agent] handler threw, falling through to Chatbase:", err);
    return false;
  }
}

function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+(?:\|[^>]*)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
