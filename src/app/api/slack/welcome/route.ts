import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";
import { INSTRUCTIONS_MESSAGE } from "@/lib/slack/commands";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { team_id, channel_id } = body;

  if (!team_id || !channel_id) {
    return NextResponse.json(
      { error: "team_id and channel_id required" },
      { status: 400 }
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: team_id },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const client = getSlackClient(workspace.botToken);

    // Join the channel first so we can receive @mentions
    await client.conversations.join({
      channel: channel_id,
    });

    // Post welcome message to the selected channel
    await client.chat.postMessage({
      channel: channel_id,
      text: INSTRUCTIONS_MESSAGE,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending welcome message:", error);
    return NextResponse.json(
      { error: "Failed to send welcome message" },
      { status: 500 }
    );
  }
}
