import { NextResponse } from "next/server";

/**
 * Initiates Slack OAuth for web login (user identity)
 * This is different from the bot installation OAuth
 */
export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/slack/callback`;

  // Use identity scopes for user login (not bot scopes)
  const scopes = ["identity.basic", "identity.email", "identity.avatar"].join(
    ","
  );

  const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthUrl.searchParams.set("client_id", clientId!);
  slackAuthUrl.searchParams.set("user_scope", scopes);
  slackAuthUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(slackAuthUrl.toString());
}
