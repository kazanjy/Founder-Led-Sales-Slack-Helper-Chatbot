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
].join(",");

export async function GET() {
  const redirectUri = `${APP_URL}/api/slack/oauth/callback`;

  const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
  slackAuthUrl.searchParams.set("scope", BOT_SCOPES);
  slackAuthUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(slackAuthUrl.toString());
}
