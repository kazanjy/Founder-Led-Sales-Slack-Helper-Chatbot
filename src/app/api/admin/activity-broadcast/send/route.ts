import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";
import { fetchRecentActivity, type ActivityItem } from "@/lib/activity/recent";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const FALLBACK_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h on first run

/**
 * Build the digest message body. Slack messages over ~40k chars are
 * truncated by the API, so we cap at MAX_LINES and fold the overflow
 * into a "+N more" tail.
 */
const MAX_LINES = 80;

function formatDigest(items: ActivityItem[], since: Date): string {
  const sinceStr = since.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });

  if (items.length === 0) {
    return `*🌊 Mikey usage digest*\n_No new activity since ${sinceStr} PT._`;
  }

  const head = items.slice(0, MAX_LINES);
  const tail = items.length - head.length;

  const lines = head.map((it) => {
    const who = it.userName || "Someone";
    const ws = it.workspaceName ? ` _(${it.workspaceName})_` : "";
    const titlePart = it.title ? `: ${it.title}` : "";
    const link = APP_URL && it.link ? ` <${APP_URL}${it.link}|view>` : "";
    return `• *${who}*${ws} — ${it.label}${titlePart}${link}`;
  });

  const summary = `*🌊 Mikey usage digest* — ${items.length} action${items.length === 1 ? "" : "s"} since ${sinceStr} PT`;
  const overflow = tail > 0 ? `\n_+${tail} more not shown._` : "";
  return [summary, "", ...lines].join("\n") + overflow;
}

export async function POST() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
    select: {
      activityBroadcastWorkspaceId: true,
      activityBroadcastChannelId: true,
      activityBroadcastChannelName: true,
      activityBroadcastLastSentAt: true,
    },
  });

  if (!settings.activityBroadcastWorkspaceId || !settings.activityBroadcastChannelId) {
    return NextResponse.json(
      { error: "Activity broadcast destination is not configured" },
      { status: 400 }
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: settings.activityBroadcastWorkspaceId },
    select: { id: true, botToken: true, slackTeamName: true },
  });
  if (!workspace) {
    return NextResponse.json(
      { error: "Configured workspace no longer exists" },
      { status: 400 }
    );
  }

  const since = settings.activityBroadcastLastSentAt
    ?? new Date(Date.now() - FALLBACK_LOOKBACK_MS);

  const items = await fetchRecentActivity({ since, perType: 200 });

  const text = formatDigest(items, since);

  const client = getSlackClient(workspace.botToken);
  try {
    await client.chat.postMessage({
      channel: settings.activityBroadcastChannelId,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (err) {
    console.error("Activity broadcast send failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post to Slack" },
      { status: 500 }
    );
  }

  // Advance the watermark so the next send only picks up new items.
  // Done after the post so a Slack failure doesn't silently swallow the
  // window.
  const sentAt = new Date();
  await prisma.globalSettings.update({
    where: { id: "global" },
    data: { activityBroadcastLastSentAt: sentAt },
  });

  return NextResponse.json({
    ok: true,
    itemCount: items.length,
    sinceISO: since.toISOString(),
    sentAtISO: sentAt.toISOString(),
    workspaceName: workspace.slackTeamName,
    channelName: settings.activityBroadcastChannelName,
  });
}
