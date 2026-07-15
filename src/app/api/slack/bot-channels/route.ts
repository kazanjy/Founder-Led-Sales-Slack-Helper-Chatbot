import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBotChannels } from "@/lib/deals/slack-channel-sync";

/**
 * GET /api/slack/bot-channels — channels the Mikey bot is a MEMBER of
 * in the caller's workspace (public + private + Slack Connect). This
 * is the attachable set for deal↔channel links: the bot can only read
 * history where it's present. Differs from /api/slack/my-channels,
 * which lists all public channels for post-target pickers.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const channels = await listBotChannels(user.id);
    return NextResponse.json({ channels });
  } catch (err) {
    console.error("[slack/bot-channels] list failed:", err);
    return NextResponse.json({ error: "Failed to list channels" }, { status: 500 });
  }
}
