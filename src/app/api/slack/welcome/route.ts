import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

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

    // Post welcome message to the selected channel
    await client.chat.postMessage({
      channel: channel_id,
      text:
        "👋 Hey team! I'm Mikey, your 🌊 Founder-Led Sales assistant.\n\n" +
        `I was just added to this workspace by <@${workspace.installedByUserId}>.\n\n` +
        "Ask me anything about sales strategies, outreach, objection handling, and more - just @mention me!\n\n" +
        "Here's to some founder-led selling success! 🚀",
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
