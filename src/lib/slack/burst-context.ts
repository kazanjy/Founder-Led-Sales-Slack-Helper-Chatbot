import type { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/db";
import { getSlackClient } from "./client";

/**
 * "Same-thought" burst context for Slack invocations.
 *
 * People don't write one tidy paragraph — they fire off three short
 * notes in a row, then @mention Mikey (or reply to just one of them).
 * Slack treats those as unrelated messages; a human reading the
 * channel obviously doesn't. This walks BACKWARD from the invoking
 * message through channel history and keeps the run of preceding
 * human messages that are tightly clustered in time, so the agents
 * see the whole thought.
 *
 * Deliberately fails open: any scope/API problem returns [] and the
 * invocation proceeds exactly as it did before.
 */

/** Max quiet gap between consecutive notes before the burst is over. */
const BURST_GAP_SECONDS = 600; // 10 minutes
/** Never reach further back than this from the anchor. */
const MAX_LOOKBACK_SECONDS = 1800; // 30 minutes
/** Hard cap on messages pulled in (token + noise control). */
const MAX_BURST_MESSAGES = 8;
/** How many raw history entries to scan to find that run. */
const HISTORY_FETCH_LIMIT = 25;

export interface BurstMessage {
  /** Slack user id of the author (absent on odd payloads). */
  user?: string;
  text: string;
  ts: string;
}

function userTokenCanReadHistory(scopes: string | null): boolean {
  if (!scopes) return false;
  const set = new Set(scopes.split(",").map((s) => s.trim()));
  return set.has("channels:history") || set.has("groups:history");
}

/**
 * Prefer the founder's USER token when it carries history scopes —
 * that reads as them, so every channel they're in works without
 * inviting the bot (same posture as the deal channel sync). The bot
 * token is the fallback; it only carries im:history, so it succeeds
 * in DMs and quietly fails in channels, which the caller treats as
 * "no burst context".
 */
async function resolveHistoryClient(
  userId: string,
  botClient: WebClient
): Promise<WebClient> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { slackUserToken: true, slackUserScopes: true },
    });
    if (user?.slackUserToken && userTokenCanReadHistory(user.slackUserScopes)) {
      return getSlackClient(user.slackUserToken);
    }
  } catch {
    /* fall through to the bot client */
  }
  return botClient;
}

/**
 * The run of human messages immediately preceding `anchorTs`, oldest
 * first. Empty when the messages aren't clustered, when history isn't
 * readable, or on any error.
 *
 * @param anchorTs For a top-level mention, the mention's own ts. For a
 *   mention inside a thread, pass the THREAD ROOT's ts — the sibling
 *   notes we want sit before the root, not before the reply.
 */
export async function fetchBurstContext(opts: {
  userId: string;
  botClient: WebClient;
  channel: string;
  anchorTs: string;
  /** Bot's Slack user id, so Mikey's own posts never count as the thought. */
  botUserId: string | null;
}): Promise<BurstMessage[]> {
  const { userId, botClient, channel, anchorTs, botUserId } = opts;
  const anchorSeconds = parseFloat(anchorTs);
  if (!isFinite(anchorSeconds)) return [];

  try {
    const client = await resolveHistoryClient(userId, botClient);
    const result = await client.conversations.history({
      channel,
      latest: anchorTs,
      inclusive: false,
      limit: HISTORY_FETCH_LIMIT,
    });
    const messages = (result.messages || []) as Array<{
      user?: string;
      bot_id?: string;
      subtype?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    }>;

    // Slack returns newest-first. Walk backward in time, keeping the
    // run while each hop stays inside the gap window.
    const kept: BurstMessage[] = [];
    let previousSeconds = anchorSeconds;

    for (const m of messages) {
      if (kept.length >= MAX_BURST_MESSAGES) break;
      if (!m.ts) continue;
      const seconds = parseFloat(m.ts);
      if (!isFinite(seconds)) continue;

      // Mikey's own posts (alerts, prior answers) are transparent:
      // they neither join the thought nor break the chain, since an
      // autopilot alert can land mid-burst.
      const isBot = !!m.bot_id || (!!botUserId && m.user === botUserId);
      if (isBot) continue;

      // Plain human channel messages only — joins/leaves/topic
      // changes and thread-reply broadcasts aren't the thought.
      if (m.subtype) continue;
      const text = (m.text || "").trim();
      if (!text) continue;

      if (anchorSeconds - seconds > MAX_LOOKBACK_SECONDS) break;
      if (previousSeconds - seconds > BURST_GAP_SECONDS) break;

      kept.push({ user: m.user, text, ts: m.ts });
      previousSeconds = seconds;
    }

    return kept.reverse(); // oldest first — reads as the conversation
  } catch (err) {
    // missing_scope in a channel without the user token is the common
    // case and entirely expected; log at debug volume and move on.
    console.log(
      `[slack burst-context] skipped for channel ${channel}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Flatten for keyword/deal-name detection haystacks. */
export function burstDetectionText(burst: BurstMessage[]): string {
  return burst.map((b) => b.text).join(" ");
}
