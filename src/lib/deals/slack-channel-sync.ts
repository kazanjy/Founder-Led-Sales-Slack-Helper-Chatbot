import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

/**
 * Deal ↔ shared Slack channel sync. Founders who sell in Slack
 * Connect channels attach the channel to the deal; new messages get
 * pulled on the 5-min cron (and via "Sync now") and land as
 * slack_message timeline DIGEST entries — one entry per sync batch,
 * speakers resolved to names, thread replies included. Once they're
 * timeline entries, the analyzer / deal chat / pre-call plans read
 * them like any other evidence.
 *
 * Watermark = Deal.slackChannelLastTs (Slack message ts of the newest
 * ingested message). First sync backfills a bounded window so linking
 * an old channel doesn't import a year of chatter.
 */

const FIRST_SYNC_LOOKBACK_DAYS = 14;
const MAX_MESSAGES_PER_SYNC = 200;
const MAX_THREADS_PER_SYNC = 10;
const MAX_ENTRY_CHARS = 20_000;

interface SlackMessage {
  ts?: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  reply_count?: number;
}

async function resolveWorkspaceClient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { workspaceId: true },
  });
  if (!user?.workspaceId) return null;
  const ws = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!ws?.botToken) return null;
  return getSlackClient(ws.botToken);
}

export interface BotChannel {
  id: string;
  name: string;
  isShared: boolean;
  isPrivate: boolean;
}

/**
 * Channels the bot is a member of in the founder's workspace — the
 * attachable set (the bot can only read history where it's present).
 * Slack Connect channels carry isShared for the picker badge.
 */
export async function listBotChannels(userId: string): Promise<BotChannel[]> {
  const client = await resolveWorkspaceClient(userId);
  if (!client) return [];
  const out: BotChannel[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await client.users.conversations({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const c of res.channels || []) {
      if (!c.id || !c.name) continue;
      out.push({
        id: c.id,
        name: c.name,
        isShared: !!(c.is_shared || c.is_ext_shared),
        isPrivate: !!c.is_private,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    pages++;
  } while (cursor && pages < 5);
  out.sort((a, b) => Number(b.isShared) - Number(a.isShared) || a.name.localeCompare(b.name));
  return out;
}

function tsToDate(ts: string): Date {
  return new Date(parseFloat(ts) * 1000);
}

export interface ChannelSyncResult {
  synced: boolean;
  newMessages: number;
  entryId: string | null;
  error?: string;
}

/**
 * Pull new channel messages since the watermark and land them as ONE
 * digest timeline entry. Idempotent per watermark; no-op when quiet.
 */
export async function syncDealSlackChannel(
  userId: string,
  dealId: string
): Promise<ChannelSyncResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      userId: true,
      slackChannelId: true,
      slackChannelName: true,
      slackChannelLastTs: true,
    },
  });
  if (!deal || deal.userId !== userId || !deal.slackChannelId) {
    return { synced: false, newMessages: 0, entryId: null, error: "not_linked" };
  }
  const client = await resolveWorkspaceClient(userId);
  if (!client) {
    return { synced: false, newMessages: 0, entryId: null, error: "no_workspace" };
  }

  const oldest =
    deal.slackChannelLastTs ||
    String((Date.now() - FIRST_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);

  let messages: SlackMessage[] = [];
  try {
    const history = await client.conversations.history({
      channel: deal.slackChannelId,
      oldest,
      limit: MAX_MESSAGES_PER_SYNC,
      inclusive: false,
    });
    messages = (history.messages || []) as SlackMessage[];
  } catch (err) {
    console.error(`[slack-channel-sync] history failed for deal ${dealId}:`, err);
    return { synced: false, newMessages: 0, entryId: null, error: "history_failed" };
  }

  // Human messages only, oldest→newest. Bot posts (including Mikey's
  // own stubs, if the founder linked their claimed channel) and
  // join/leave noise stay out of the evidence.
  const human = messages
    .filter((m) => m.ts && m.user && !m.bot_id && !m.subtype && (m.text || "").trim())
    .sort((a, b) => parseFloat(a.ts!) - parseFloat(b.ts!));

  if (human.length === 0) {
    return { synced: true, newMessages: 0, entryId: null };
  }

  // Resolve author names once per sync.
  const nameCache = new Map<string, string>();
  const resolveName = async (slackUserId: string): Promise<string> => {
    const cached = nameCache.get(slackUserId);
    if (cached) return cached;
    let name = slackUserId;
    try {
      const info = await client.users.info({ user: slackUserId });
      name = info.user?.real_name || info.user?.name || slackUserId;
    } catch { /* keep id */ }
    nameCache.set(slackUserId, name);
    return name;
  };

  const fmtTs = (ts: string) =>
    tsToDate(ts).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

  const lines: string[] = [];
  let threadsFetched = 0;
  for (const m of human) {
    const author = await resolveName(m.user!);
    lines.push(`[${fmtTs(m.ts!)}] ${author}: ${(m.text || "").trim()}`);
    // Pull thread replies for conversations that went deep — selling
    // threads carry the substance. Capped per sync.
    if ((m.reply_count || 0) > 0 && threadsFetched < MAX_THREADS_PER_SYNC) {
      threadsFetched++;
      try {
        const replies = await client.conversations.replies({
          channel: deal.slackChannelId,
          ts: m.thread_ts || m.ts!,
          limit: 50,
        });
        for (const r of (replies.messages || []) as SlackMessage[]) {
          if (!r.ts || r.ts === m.ts || !r.user || r.bot_id || r.subtype) continue;
          if (!(r.text || "").trim()) continue;
          const rAuthor = await resolveName(r.user);
          lines.push(`    ↳ [${fmtTs(r.ts)}] ${rAuthor}: ${(r.text || "").trim()}`);
        }
      } catch { /* thread fetch is best-effort */ }
    }
  }

  const newestTs = human[human.length - 1].ts!;
  const oldestDate = tsToDate(human[0].ts!);
  const newestDate = tsToDate(newestTs);
  const rangeLabel =
    oldestDate.toDateString() === newestDate.toDateString()
      ? newestDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : `${oldestDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${newestDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  let content = lines.join("\n");
  if (content.length > MAX_ENTRY_CHARS) {
    content = content.slice(-MAX_ENTRY_CHARS);
    content = `(older messages truncated)\n${content.slice(content.indexOf("\n") + 1)}`;
  }

  const entry = await prisma.dealTimelineEntry.create({
    data: {
      dealId: deal.id,
      type: "slack_message",
      title: `#${deal.slackChannelName || "channel"} — Slack activity (${rangeLabel}, ${human.length} message${human.length === 1 ? "" : "s"})`,
      content,
      entryDate: newestDate,
      metadata: JSON.stringify({
        auto_imported: true,
        source: "slack_channel_sync",
        slackChannelId: deal.slackChannelId,
        fromTs: human[0].ts,
        toTs: newestTs,
      }),
    },
  });

  await prisma.deal.update({
    where: { id: deal.id },
    data: { slackChannelLastTs: newestTs },
  });

  return { synced: true, newMessages: human.length, entryId: entry.id };
}

/**
 * Cron sweep: sync every linked channel on in-play deals — plus
 * closed_lost, deliberately: new chatter in a dead deal's channel is
 * re-engagement signal worth capturing (closed_won stays out; the
 * Customer Success applet owns post-close activity). Capped per tick;
 * quiet channels cost one history call each.
 */
export async function sweepLinkedSlackChannels(maxSyncs = 10): Promise<number> {
  const linked = await prisma.deal.findMany({
    where: {
      slackChannelId: { not: null },
      status: { in: ["active", "potential", "likely", "stalled", "closed_lost"] },
    },
    orderBy: { updatedAt: "asc" },
    take: maxSyncs,
    select: { id: true, userId: true },
  });
  let ingested = 0;
  for (const deal of linked) {
    try {
      const result = await syncDealSlackChannel(deal.userId, deal.id);
      if (result.newMessages > 0) {
        ingested++;
        console.log(
          `[slack-channel-sync] deal ${deal.id}: ingested ${result.newMessages} message(s)`
        );
      }
    } catch (err) {
      console.error(`[slack-channel-sync] sweep failed for deal ${deal.id}:`, err);
    }
  }
  return ingested;
}
