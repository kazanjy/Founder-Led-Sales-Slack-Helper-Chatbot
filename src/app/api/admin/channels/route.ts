import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { syncChannelClaim } from "@/lib/slack/channels";

// GET /api/admin/channels?workspaceId=<id>
// Lists every ChannelClaim in a workspace, sorted by most recent activity
// first (channels with no recorded activity fall to the bottom).
export async function GET(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const channels = await prisma.channelClaim.findMany({
    where: { workspaceId },
    // NULLs last on DESC — channels with no recorded activity yet should sit
    // at the bottom of the list, not the top (Postgres's default on DESC is
    // NULLS FIRST, so we have to say it explicitly).
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      slackChannelId: true,
      slackChannelName: true,
      lastMessageAt: true,
      createdAt: true,
      account: { select: { id: true, name: true } },
      claimedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Fire-and-forget: any row missing a human-readable name was claimed
  // without one and has never had a message event fire since. Pull fresh
  // metadata from Slack so the next refresh shows a real name instead of
  // the raw channel ID.
  for (const c of channels) {
    if (!c.slackChannelName) void syncChannelClaim(c.id);
  }

  return NextResponse.json({ channels });
}
