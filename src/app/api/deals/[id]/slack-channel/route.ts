import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { syncDealSlackChannel } from "@/lib/deals/slack-channel-sync";

/**
 * Deal ↔ shared Slack channel link.
 *
 *   PUT    { channelId, channelName } — link (kicks an immediate sync)
 *   POST                              — "Sync now"
 *   DELETE                           — unlink (entries stay; watermark
 *                                      clears so a re-link backfills
 *                                      the recent window again)
 */

export const maxDuration = 120;

async function ownedDeal(dealId: string, userId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, userId: true },
  });
  return deal && deal.userId === userId ? deal : null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    if (!(await ownedDeal(id, user.id))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const { channelId, channelName } = await request.json();
    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }
    await prisma.deal.update({
      where: { id },
      data: {
        slackChannelId: channelId,
        slackChannelName: typeof channelName === "string" ? channelName.replace(/^#/, "") : null,
        slackChannelLastTs: null, // fresh link → bounded backfill
      },
    });
    // Immediate first sync so the founder sees channel history land
    // right away instead of waiting for the next cron tick.
    const sync = await syncDealSlackChannel(user.id, id);
    return NextResponse.json({ ok: true, sync });
  } catch (err) {
    console.error("[deal slack-channel] link failed:", err);
    return NextResponse.json({ error: "Failed to link channel" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    if (!(await ownedDeal(id, user.id))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const sync = await syncDealSlackChannel(user.id, id);
    return NextResponse.json({ ok: sync.synced, sync });
  } catch (err) {
    console.error("[deal slack-channel] sync failed:", err);
    return NextResponse.json({ error: "Failed to sync channel" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    if (!(await ownedDeal(id, user.id))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    await prisma.deal.update({
      where: { id },
      data: { slackChannelId: null, slackChannelName: null, slackChannelLastTs: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[deal slack-channel] unlink failed:", err);
    return NextResponse.json({ error: "Failed to unlink channel" }, { status: 500 });
  }
}
