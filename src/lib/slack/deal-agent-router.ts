import type { WebClient } from "@slack/web-api";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db";
import { sendSlackMessage, getThreadMessages } from "./client";
import { markdownToSlack } from "./markdown";
import { runDealAgent } from "@/lib/agents/deals/run";

// Cap thread history we feed back to the agent so a 50-message thread
// doesn't blow up tokens. Most relevant context lives in the most
// recent exchanges anyway.
const MAX_THREAD_HISTORY = 12;

/**
 * Decide whether an inbound Slack message should be handled by the
 * deal-tool-using agent (instead of Chatbase). First-cut heuristic:
 * the message contains a substring match against any of the user's
 * own deal names or company names. That's intentionally narrow — it
 * gives the agent the questions it's clearly meant for ("what's the
 * status with Sourcebot?") and lets everything else fall through to
 * Chatbase as before.
 *
 * Returns true when the message was handled (i.e. the caller should
 * NOT continue with the Chatbase flow). Returns false when no deal
 * name was found and the caller should keep going.
 *
 * Intentionally tolerant: any handler exception is logged and
 * returns false so a broken agent doesn't black-hole the user's
 * message — Chatbase will still respond.
 */
export async function tryHandleWithDealAgent(opts: {
  // The Slack speaker's Mikey user id. May be a prospect in a
  // claimed channel — we swap to the channel owner below.
  speakerUserId: string;
  text: string;
  client: WebClient;
  channel: string;
  threadTs: string | undefined;
  // The bot's Slack user id so we can label its prior thread
  // replies as "assistant" turns in the agent history.
  botUserId: string;
  // Slack ts of the current message — used to skip it when reading
  // thread history (it's already passed in as `text`).
  messageTs: string;
  // The thread parent's ts. When this differs from messageTs, the
  // user mentioned Mikey in an existing thread and we need to load
  // the prior turns for both deal-name detection AND agent context.
  threadRootTs: string | undefined;
}): Promise<boolean> {
  const { speakerUserId, text, client, channel, threadTs, botUserId, messageTs, threadRootTs } = opts;

  try {
    const cleaned = stripSlackMentions(text || "").trim();
    if (!cleaned) return false;

    // Resolve the context user. When the channel is claimed by an
    // account, Mikey acts on behalf of the CHANNEL OWNER, not the
    // person currently typing (who may be a prospect with no deals
    // at all). Mirrors the contextUserId pattern in the Chatbase
    // path further down handleMention. Without this, deal lookup
    // runs against the wrong user in claimed channels and the
    // router silently bails out — which is the bug the user just
    // reported.
    const channelClaim = await prisma.channelClaim.findUnique({
      where: { slackChannelId: channel },
      select: { claimedByUserId: true, accountId: true },
    });
    const contextUserId = channelClaim?.claimedByUserId || speakerUserId;
    if (channelClaim && channelClaim.claimedByUserId !== speakerUserId) {
      console.log(
        `[slack→deal-agent] channel ${channel} is claimed; swapping ` +
          `speaker=${speakerUserId} → contextUser=${channelClaim.claimedByUserId}`
      );
    }

    const deals = await prisma.deal.findMany({
      where: { userId: contextUserId, status: { notIn: ["dismissed"] } },
      select: { name: true, companyName: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    if (deals.length === 0) {
      console.log(
        `[slack→deal-agent] no deals in account for contextUser=${contextUserId}; falling through`
      );
      return false;
    }

    // Thread context. When the user @mentions Mikey in an existing
    // thread, the new message might be a follow-up ("what contacts
    // are involved?") that doesn't itself name the deal — but the
    // thread parent or earlier turns do. Pull thread history so:
    //   (a) deal-name detection runs against the full thread, not
    //       just the current message — fixes the "thread is clearly
    //       about MongoDB but the follow-up doesn't say MongoDB"
    //       case the user just hit.
    //   (b) the agent gets prior turns in its conversation history
    //       and can answer with the right deal context loaded.
    let priorThread: Array<{
      role: "user" | "assistant";
      text: string;
    }> = [];
    if (threadRootTs && threadRootTs !== messageTs) {
      try {
        const raw = await getThreadMessages(client, channel, threadRootTs);
        for (const m of raw) {
          if (m.ts === messageTs) continue; // skip the current msg
          const txt = stripSlackMentions(m.text || "").trim();
          if (!txt) continue;
          // Treat anything from the bot as assistant; everything
          // else (including teammates in a claimed channel) as user
          // input so the agent has full conversational context.
          const role = m.bot_id || m.user === botUserId ? "assistant" : "user";
          priorThread.push({ role, text: txt });
        }
        // Cap to the most recent N turns to bound token cost.
        if (priorThread.length > MAX_THREAD_HISTORY) {
          priorThread = priorThread.slice(-MAX_THREAD_HISTORY);
        }
        if (priorThread.length > 0) {
          console.log(
            `[slack→deal-agent] loaded ${priorThread.length} prior thread turns for deal context`
          );
        }
      } catch (err) {
        console.error("[slack→deal-agent] failed to load thread history:", err);
      }
    }

    // Detect deal names against the CURRENT message first; if no
    // match, retry against current + prior thread text combined.
    // Order matters because we want to prefer a fresh deal mention
    // ("now about Acme") over a deal named further up the thread.
    let matchedDeal = findDealNameInText(cleaned, deals);
    if (!matchedDeal && priorThread.length > 0) {
      const combined = [cleaned, ...priorThread.map((m) => m.text)].join(" ");
      matchedDeal = findDealNameInText(combined, deals);
      if (matchedDeal) {
        console.log(
          `[slack→deal-agent] matched deal "${matchedDeal}" from thread context, not current message`
        );
      }
    }

    if (!matchedDeal) {
      // Log enough to diagnose "the agent should have fired but
      // didn't" cases. Shows the user, the message we were
      // matching against, and the first few deal labels we tried
      // — so if the user's deal is called "Mongo Inc." they'll
      // see why "MongoDB" didn't match.
      const sample = deals
        .slice(0, 8)
        .map((d) => `${d.companyName} / ${d.name}`)
        .join(" | ");
      console.log(
        `[slack→deal-agent] no deal match for user=${contextUserId} text="${cleaned.substring(0, 140)}" — first ${Math.min(deals.length, 8)} of ${deals.length} deals: ${sample}`
      );
      return false;
    }

    console.log(`[slack→deal-agent] user=${contextUserId} matched=${matchedDeal} text=${cleaned.substring(0, 120)}`);

    // Brief "thinking" status so the user sees Mikey received the
    // message during the multi-turn tool loop.
    await sendSlackMessage(
      client,
      channel,
      `_:wave: Looking into the ${matchedDeal} deal…_`,
      threadTs
    );

    const conversationHistory: ChatCompletionMessageParam[] = priorThread.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    const result = await runDealAgent({
      userId: contextUserId,
      userMessage: cleaned,
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    });
    const slackReply = markdownToSlack(result.reply);
    await sendSlackMessage(client, channel, slackReply, threadTs);

    console.log(
      `[slack→deal-agent] user=${contextUserId} turns=${result.turns} tools=${result.trace.length}${result.hitTurnCap ? " hitTurnCap" : ""}`
    );
    return true;
  } catch (err) {
    console.error("[slack→deal-agent] handler threw, falling through:", err);
    return false;
  }
}

// Slack wraps user / bot mentions in <@U123> and channel mentions
// in <#C123|name>. Strip them so substring matches against deal
// names work cleanly.
function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+(?:\|[^>]*)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Substring-match the message against the user's deal names and
 * company names. Returns the longest-matching label so we report
 * "Acme Corp" instead of "Acme" when both are deal names. Token-
 * bounded match — e.g. "Acme" doesn't accidentally match "Acmeology"
 * mid-word.
 */
function findDealNameInText(
  text: string,
  deals: Array<{ name: string; companyName: string }>
): string | null {
  const haystack = ` ${text.toLowerCase().replace(/[^\w\s]/g, " ")} `;
  const candidates: string[] = [];
  for (const d of deals) {
    for (const raw of [d.name, d.companyName]) {
      const normalized = raw.trim();
      if (normalized.length < 3) continue;
      // Match the labels by their distinct tokens (longer than 2
      // chars) so noisy names like "New Business" pieces don't
      // false-positive on every Slack message.
      const tokens = normalized
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2);
      if (tokens.length === 0) continue;
      const allPresent = tokens.every((t) => haystack.includes(` ${t} `));
      if (allPresent) candidates.push(normalized);
    }
  }
  if (candidates.length === 0) return null;
  // Prefer longest match — handles overlapping deal/company labels.
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}
