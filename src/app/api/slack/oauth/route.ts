import { NextResponse } from "next/server";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Scopes required for Mikey
const BOT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "chat:write.public", // Post to public channels without joining
  "channels:read", // List channels for setup page
  "channels:join", // Join channels during setup
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "files:read", // Read file attachments in messages
].join(",");

// User-scope tokens (xoxp-…) so the broadcast tool can post on behalf
// of an admin instead of as MikeyBot — central to the "founder-led
// sales" frame. Slack returns one in `authed_user.access_token` on the
// OAuth callback whenever the user grants any user_scope here.
const USER_SCOPES = [
  "chat:write",
].join(",");

export async function GET() {
  const redirectUri = `${APP_URL}/api/slack/oauth/callback`;

  const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
  slackAuthUrl.searchParams.set("scope", BOT_SCOPES);
  slackAuthUrl.searchParams.set("user_scope", USER_SCOPES);
  slackAuthUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(slackAuthUrl.toString());
}
