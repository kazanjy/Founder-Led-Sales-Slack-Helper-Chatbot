import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { postResearchToSlack } from "@/lib/pre-call/slack-broadcast";

/**
 * POST /api/pre-call-planning/research/[id]/send-to-slack
 *
 * Thin wrapper around the shared postResearchToSlack helper so both
 * the manual button click and the daily-research-briefs cron use
 * the same message formatter (otherwise the splitter / heading
 * tweaks made for one path silently miss the other).
 */

interface Body {
  destination?: "dm" | "channel";
  channelId?: string;
  channelName?: string;
  saveAsPreferred?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.workspaceId) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as Body;
  const destination = body.destination === "dm" ? "dm" : "channel";
  if (destination === "channel" && !body.channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  const research = await prisma.preCallResearch.findFirst({
    where: { id, userId: user.id },
  });
  if (!research) {
    return NextResponse.json({ error: "Research not found" }, { status: 404 });
  }

  const result = await postResearchToSlack({
    userId: user.id,
    research: {
      id: research.id,
      companyName: research.companyName,
      contactName: research.contactName,
      contactTitle: research.contactTitle,
      contactEmail: research.contactEmail,
      contactLinkedIn: research.contactLinkedIn,
      content: research.content,
      calendarEvent: research.calendarEvent,
    },
    destination,
    channelId: body.channelId ?? null,
  });

  if (!result.ok) {
    const message = result.error || "";
    const friendly =
      /not_in_channel/.test(message)
        ? "Mikey isn't a member of that channel. Invite the bot, then try again."
        : /channel_not_found/.test(message)
          ? "Channel not found or not visible to Mikey."
          : /no_slack_dm|slackUserId/i.test(message)
            ? "No Slack identity available for DM delivery."
            : message || "Failed to post to Slack. Try a different channel.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }

  // Persist the channel preference on first explicit save.
  if (destination === "channel" && body.saveAsPreferred && body.channelId) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        preferredResearchSlackChannelId: body.channelId,
        preferredResearchSlackChannelName: body.channelName || null,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
