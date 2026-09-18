import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

/**
 * GET /api/slack/my-channels
 *
 * Returns the public channels in the current user's Slack workspace,
 * for UI pickers that let the user choose where to post (e.g. the
 * "Send to Slack" button on the pre-call research brief). 403s if
 * the user has no associated workspace.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.workspaceId) {
    return NextResponse.json({ error: "no_workspace", channels: [] }, { status: 403 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { botToken: true },
  });
  if (!workspace?.botToken) {
    return NextResponse.json({ error: "no_workspace", channels: [] }, { status: 403 });
  }

  try {
    const client = getSlackClient(workspace.botToken);
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
    });

    const channels = (result.channels || [])
      .filter((ch) => ch.id && ch.name)
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        isMember: ch.is_member,
        isPrivate: ch.is_private,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("[my-channels] List failed:", error);
    return NextResponse.json({ error: "Failed to list channels" }, { status: 500 });
  }
}
