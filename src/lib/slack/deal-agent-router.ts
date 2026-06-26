import type { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/db";
import { sendSlackMessage } from "./client";
import { markdownToSlack } from "./markdown";
import { runDealAgent } from "@/lib/agents/deals/run";

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
}): Promise<boolean> {
  const { speakerUserId, text, client, channel, threadTs } = opts;

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
    if (deals.length === 0) return false;

    const matchedDeal = findDealNameInText(cleaned, deals);
    if (!matchedDeal) return false;

    console.log(`[slack→deal-agent] user=${contextUserId} matched=${matchedDeal} text=${cleaned.substring(0, 120)}`);

    // Brief "thinking" status so the user sees Mikey received the
    // message during the multi-turn tool loop.
    await sendSlackMessage(
      client,
      channel,
      `_:wave: Looking into the ${matchedDeal} deal…_`,
      threadTs
    );

    const result = await runDealAgent({ userId: contextUserId, userMessage: cleaned });
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
