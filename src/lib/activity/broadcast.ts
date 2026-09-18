import { after } from "next/server";
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
 * Schedule the broadcast without making the originating request wait
 * for it to finish. We use Next 15's `after()` so the serverless
 * runtime keeps the function alive until the Slack post resolves —
 * a plain `void promise` gets killed when Vercel terminates the
 * function on response, so most broadcasts would otherwise silently
 * drop on quick non-streaming routes.
 *
 * `after()` throws when called outside a request scope (e.g. cron
 * scripts, build-time codepaths that touch Prisma). Fall back to a
 * plain promise in that case — it's better than crashing the
 * originating action.
 */
export function broadcastActivityFireAndForget(input: BroadcastEventInput): void {
  try {
    after(broadcastActivity(input));
  } catch (err) {
    console.warn("[activity-broadcast] after() unavailable, falling back to void promise:", err);
    void broadcastActivity(input);
  }
}
