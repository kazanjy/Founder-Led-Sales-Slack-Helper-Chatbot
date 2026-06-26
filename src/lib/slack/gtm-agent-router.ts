import type { WebClient } from "@slack/web-api";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { sendSlackMessage, getThreadMessages } from "./client";
import { markdownToSlack } from "./markdown";
import { runGtmAgent } from "@/lib/agents/gtm/run";

/**
 * Default-everything-else Slack router. Catches messages the deal +
 * coaching routers don't claim and hands them to the GTM agent
 * instead of the legacy Chatbase send path. The GTM agent has the
 * Chatbase RAG corpus available as a TOOL
 * (searchFounderLedSalesPlaybook), so a generic founder-led-sales
 * question resolves to one tool call against the same playbook
 * content — just routed through the agent loop now.
 *
 * Falls through (returns false) for messages with file attachments
 * so Chatbase's existing image/PDF/OCR pipeline keeps running for
 * those. Eventually we'd fold file handling into the GTM agent's
 * tool surface, but not in this commit.
 */

const MAX_THREAD_HISTORY = 12;

export async function tryHandleWithGtmAgent(opts: {
  speakerUserId: string;
  text: string;
  hasFiles: boolean;
  client: WebClient;
  channel: string;
  threadTs: string | undefined;
  botUserId: string | null;
  messageTs: string;
  threadRootTs: string | undefined;
}): Promise<boolean> {
  const { speakerUserId, text, hasFiles, client, channel, threadTs, botUserId, messageTs, threadRootTs } = opts;

  try {
    // Files attached → fall through to Chatbase's existing OCR /
    // image-attachment plumbing. The GTM agent doesn't have file
    // tools yet.
    if (hasFiles) return false;

    const cleaned = stripSlackMentions(text || "").trim();
    if (!cleaned) return false;

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

    const conversationHistory: ChatCompletionMessageParam[] = priorThread.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    const result = await runGtmAgent({
      userId: contextUserId,
      userMessage: cleaned,
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    });

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
