import { prisma } from "@/lib/db";
import { getSlackClient } from "./client";

/**
 * Backfill a ChannelClaim row with its Slack-side metadata (display name
 * and most-recent-message timestamp). Safe to fire-and-forget — all
 * failure modes (missing workspace, missing scope, private channels the
 * bot isn't in, etc.) are caught and logged.
 *
 * Only issues a Slack call when at least one of the cached fields is
 * null, so re-calling this on an already-populated claim is a cheap
 * DB read.
 */
export async function syncChannelClaim(claimId: string): Promise<void> {
  try {
    const claim = await prisma.channelClaim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        slackChannelId: true,
        slackChannelName: true,
        lastMessageAt: true,
        workspace: { select: { botToken: true } },
      },
    });
    if (!claim) return;
    if (claim.slackChannelName && claim.lastMessageAt) return;

    const client = getSlackClient(claim.workspace.botToken);
    const info = await client.conversations.info({ channel: claim.slackChannelId });
    const channel = info.channel as
      | { name?: string; latest?: { ts?: string } }
      | undefined;
    if (!channel) return;

    const updates: { slackChannelName?: string; lastMessageAt?: Date } = {};
    if (!claim.slackChannelName && channel.name) {
      updates.slackChannelName = `#${channel.name}`;
    }
    // conversations.info includes `latest` when the bot is a channel
    // member. Going forward, the message-event handler keeps this
    // fresh; this just seeds the field for channels that were claimed
    // before the event handler was in place.
    if (!claim.lastMessageAt && channel.latest?.ts) {
      const seconds = parseFloat(channel.latest.ts);
      if (Number.isFinite(seconds)) {
        updates.lastMessageAt = new Date(seconds * 1000);
      }
    }

    if (Object.keys(updates).length === 0) return;
    await prisma.channelClaim.update({ where: { id: claimId }, data: updates });
  } catch (err) {
    console.error(`syncChannelClaim ${claimId} failed:`, err);
  }
}
