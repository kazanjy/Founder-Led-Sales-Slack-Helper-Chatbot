import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listAttachableChannels } from "@/lib/deals/slack-channel-sync";

/**
 * GET /api/slack/bot-channels — the attachable channel set for
 * deal↔channel links. With the founder's user token (granted via
 * /api/slack/oauth re-auth): every channel THEY are in, Slack Connect
 * included. Without it: only channels the bot is a member of, and
 * viaUserToken:false tells the picker to offer the connect upgrade.
 * Differs from /api/slack/my-channels, which lists public channels
 * for post-target pickers.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { channels, viaUserToken } = await listAttachableChannels(user.id);
    return NextResponse.json({ channels, viaUserToken });
  } catch (err) {
    console.error("[slack/bot-channels] list failed:", err);
    return NextResponse.json({ error: "Failed to list channels" }, { status: 500 });
  }
}
