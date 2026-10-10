import { NextRequest, NextResponse } from "next/server";

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

// User-scope tokens (xoxp-…). Two jobs:
//  - chat:write: the broadcast tool posts on behalf of an admin
//    instead of as MikeyBot — central to the "founder-led sales" frame.
//  - channel read scopes: the deal↔Slack-channel sync reads AS THE
//    FOUNDER, so any channel they're in (public, private, Slack
//    Connect) is attachable without inviting the bot to each one.
// Slack returns the token in `authed_user.access_token` on the OAuth
// callback whenever the user grants any user_scope here.
const USER_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "channels:history",
  "groups:history",
].join(",");

export async function GET(request: NextRequest) {
  const redirectUri = `${APP_URL}/api/slack/oauth/callback`;

  const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
  slackAuthUrl.searchParams.set("scope", BOT_SCOPES);
  slackAuthUrl.searchParams.set("user_scope", USER_SCOPES);
  slackAuthUrl.searchParams.set("redirect_uri", redirectUri);

  // Optional return_to so callers (e.g., the channels-page "Connect
  // Slack" button) can land the user back where they came from instead
  // of /setup. Slack round-trips `state` verbatim, which makes this
  // independent of cookie behaviour during the cross-site OAuth
  // redirect — the previous loggedInUser-cookie approach was too
  // fragile to rely on. The callback validates that the path is
  // same-origin (starts with `/`, no `//`) before redirecting.
  const returnTo = request.nextUrl.searchParams.get("return_to");
  if (returnTo) slackAuthUrl.searchParams.set("state", returnTo);

  return NextResponse.redirect(slackAuthUrl.toString());
}
