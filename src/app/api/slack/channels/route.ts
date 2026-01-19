import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("team_id");

  if (!teamId) {
    return NextResponse.json({ error: "team_id required" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const client = getSlackClient(workspace.botToken);

    // Get public channels
    const result = await client.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
    });

    const channels = (result.channels || [])
      .filter((ch) => ch.id && ch.name)
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        is_member: ch.is_member,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Error listing channels:", error);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}
