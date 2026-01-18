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

    if (!tokenData.ok) {
      console.error("Token exchange error:", tokenData);
      return NextResponse.redirect(`${APP_URL}?error=token_exchange_failed`);
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
            "Hey! I'm Mikey, your Founder-Led Sales assistant. Here's what I can help with:\n\n" +
            "• Crafting cold outreach messages\n" +
            "• Handling objections\n" +
            "• Pricing strategy advice\n" +
            "• Sales call preparation\n" +
            "• Follow-up sequences\n\n" +
            "*Get started:* Just @mention me in any channel with your question, or message me directly here!\n\n" +
            "_Your trial has started. Enjoy exploring!_",
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
    return NextResponse.redirect(`${APP_URL}?error=server_error`);
  }
}
