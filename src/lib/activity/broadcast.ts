import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

export interface BroadcastEventInput {
  type: string;
  id: string;
  label: string;
  title?: string | null;
  link: string; // app-relative path, e.g. "/sales-narrative?version=abc"
  userId: string;
}

/**
 * Post a single user-meaningful action into the admin-configured Slack
 * channel. No-ops when the destination isn't configured. All errors are
 * swallowed and logged — the originating action must never fail because
 * the broadcast did.
 *
 * Each post includes a click-through link back into Mikey so the
 * admin can jump straight to the asset.
 */
export async function broadcastActivity(input: BroadcastEventInput): Promise<void> {
  try {
    const settings = await prisma.globalSettings.findUnique({
      where: { id: "global" },
      select: {
        activityBroadcastWorkspaceId: true,
        activityBroadcastChannelId: true,
      },
    });
    if (!settings?.activityBroadcastWorkspaceId || !settings.activityBroadcastChannelId) {
      return;
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: settings.activityBroadcastWorkspaceId },
      select: { botToken: true },
    });
    if (!workspace) return;

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        name: true,
        slackUserName: true,
        email: true,
        workspace: { select: { slackTeamName: true } },
      },
    });

    const who = user?.name || user?.slackUserName || user?.email || "Someone";
    const ws = user?.workspace?.slackTeamName ? ` _(${user.workspace.slackTeamName})_` : "";
    const titlePart = input.title ? `: ${input.title}` : "";
    const link = APP_URL ? ` <${APP_URL}${input.link}|view>` : "";

    const text = `• *${who}*${ws} — ${input.label}${titlePart}${link}`;

    const client = getSlackClient(workspace.botToken);
    await client.chat.postMessage({
      channel: settings.activityBroadcastChannelId,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });

    // Advance the digest watermark so a follow-up "Send digest now"
    // doesn't re-post items we already broadcast in real time. Race
    // condition between concurrent broadcasts is benign — we want a
    // high-water mark and last-write-wins gives us that.
    await prisma.globalSettings.update({
      where: { id: "global" },
      data: { activityBroadcastLastSentAt: new Date() },
    });
  } catch (err) {
    console.error("[activity-broadcast] post failed:", err);
  }
}

/**
 * Schedule the broadcast without awaiting. Use after a successful
 * commit so the originating request returns promptly.
 */
export function broadcastActivityFireAndForget(input: BroadcastEventInput): void {
  void broadcastActivity(input);
}
