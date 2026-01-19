import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID!;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  console.log("OAuth callback started", {
    hasCode: !!code,
    error,
    APP_URL,
    hasClientId: !!SLACK_CLIENT_ID,
    hasClientSecret: !!SLACK_CLIENT_SECRET,
  });

  if (error) {
    console.error("OAuth error:", error);
    return NextResponse.redirect(`${APP_URL}?error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${APP_URL}?error=no_code`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: `${APP_URL}/api/slack/oauth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log("Token exchange response:", { ok: tokenData.ok, error: tokenData.error });

    if (!tokenData.ok) {
      console.error("Token exchange error:", tokenData);
      return NextResponse.redirect(`${APP_URL}?error=token_exchange_failed&reason=${encodeURIComponent(tokenData.error || 'unknown')}`);
    }

    const {
      access_token: botToken,
      team: { id: teamId, name: teamName },
      authed_user: { id: installedByUserId },
      bot_user_id: botUserId,
    } = tokenData;

    // Create or update workspace
    const workspace = await prisma.workspace.upsert({
      where: { slackTeamId: teamId },
      update: {
        slackTeamName: teamName,
        botToken,
        botUserId,
        installedByUserId,
      },
      create: {
        slackTeamId: teamId,
        slackTeamName: teamName,
        botToken,
        botUserId,
        installedByUserId,
      },
    });

    // Ensure global settings exist
    await prisma.globalSettings.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });

    // Send welcome DM to the installer
    try {
      const client = getSlackClient(botToken);

      // Open a DM channel with the installer
      const dmResult = await client.conversations.open({
        users: installedByUserId,
      });

      if (dmResult.channel?.id) {
        await client.chat.postMessage({
          channel: dmResult.channel.id,
          text:
            "👋 Hey! I'm Mikey, your 🌊 Founder-Led Sales assistant.\n\n" +
            "I'm here to help you with everything Pete can help you with - sales strategies, outreach, objection handling, and more.\n\n" +
            "*How to use me:*\n" +
            "• Mention me in any channel: `@Mikey how do I handle pricing objections?`\n" +
            "• Or DM me directly right here!\n\n" +
            "I'll always respond in a thread to keep conversations organized.\n\n" +
            "Here's to some founder-led selling success! 🚀",
        });
      }
    } catch (dmError) {
      // Don't fail installation if DM fails
      console.error("Error sending welcome DM:", dmError);
    }

    // Redirect to success page
    return NextResponse.redirect(`${APP_URL}?installed=true&workspace=${encodeURIComponent(teamName)}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    const errorMessage = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(`${APP_URL}?error=server_error&reason=${encodeURIComponent(errorMessage)}`);
  }
}
