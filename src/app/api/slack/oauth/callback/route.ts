import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { findOrCreateAccountForUser } from "@/lib/accounts";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID!;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Helper to get current logged-in user from session cookie
 */
async function getLoggedInUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) return null;

  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;

  return session.user;
}

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
      authed_user: {
        id: installedByUserId,
        access_token: userAccessToken,
        scope: userScope,
      },
      bot_user_id: botUserId,
    } = tokenData;

    // Captured here, written onto the resolved User row at the end of
    // the user-resolution flow below. May be undefined when the
    // installer didn't grant any user_scope — that's fine, the column
    // is nullable and the broadcast tool will prompt them to re-auth.
    const slackUserToken: string | null = userAccessToken || null;
    const slackUserScopes: string | null = userScope || null;

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

    // Check if user is already logged in (e.g., Google user adding Slack)
    const loggedInUser = await getLoggedInUser();

    // Check if this Slack identity is already linked to a user in this workspace
    const existingSlackUser = await prisma.user.findUnique({
      where: {
        slackUserId_workspaceId: {
          slackUserId: installedByUserId,
          workspaceId: workspace.id,
        },
      },
    });

    let user;

    if (loggedInUser) {
      // User is already logged in (e.g., Google user adding Slack)
      if (existingSlackUser && existingSlackUser.id !== loggedInUser.id) {
        // This Slack identity is already linked to a different account
        console.error(
          `Slack identity conflict during install: ${installedByUserId} already linked to user ${existingSlackUser.id}`
        );
        return NextResponse.redirect(
          `${APP_URL}/setup?workspace=${encodeURIComponent(teamName)}&team_id=${teamId}&error=slack_already_linked`
        );
      }

      // Link Slack to the existing logged-in user
      user = await prisma.user.update({
        where: { id: loggedInUser.id },
        data: {
          slackUserId: installedByUserId,
          workspaceId: workspace.id,
        },
      });
      console.log(
        `[Slack Install] Linked Slack to existing user: ${loggedInUser.id}`
      );
    } else if (existingSlackUser) {
      // Not logged in, but Slack user exists - create session for them
      user = existingSlackUser;
    } else {
      // Not logged in, new Slack user - create user record
      // Fetch installer's profile from Slack to get their email
      let installerEmail: string | null = null;
      let installerName: string | null = null;
      try {
        const slackClient = getSlackClient(botToken);
        const profileResult = await slackClient.users.info({ user: installedByUserId });
        installerEmail = profileResult.user?.profile?.email || null;
        installerName = profileResult.user?.real_name || profileResult.user?.name || null;
      } catch (profileErr) {
        console.error("[Slack Install] Could not fetch installer profile:", profileErr);
      }

      // Check if a user with this email already exists before creating
      if (installerEmail) {
        const existingByEmail = await prisma.user.findFirst({
          where: {
            OR: [
              { email: installerEmail },
              { slackEmail: installerEmail },
              { secondaryEmails: { has: installerEmail } },
            ],
          },
        });

        if (existingByEmail) {
          // Link existing user to this Slack workspace
          user = await prisma.user.update({
            where: { id: existingByEmail.id },
            data: {
              slackUserId: installedByUserId,
              workspaceId: workspace.id,
              slackEmail: installerEmail,
              slackUserName: installerName || existingByEmail.slackUserName,
            },
          });
          console.log(`[Slack Install] Linked existing user ${user.id} to Slack workspace`);
        }
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            slackUserId: installedByUserId,
            workspaceId: workspace.id,
            slackEmail: installerEmail,
            slackUserName: installerName,
            trialStartedAt: new Date(),
            licenseStatus: "TRIAL",
          },
        });
        console.log(`[Slack Install] Created new user for installer: ${user.id}`);
      }

      // Auto-create or join an Account (if we have an email)
      if (installerEmail) {
        user = await findOrCreateAccountForUser(user.id, installerEmail, installerName);
      }
    }

    // Persist the user-scope token (if granted) onto the resolved User
    // row. Writing only when present avoids stomping a previously
    // granted token if the user re-installs through a flow that
    // happened to drop user_scope from the URL.
    if (slackUserToken) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { slackUserToken, slackUserScopes },
      });
    }

    // Create session for the user (new session even if they had one)
    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt,
      },
    });

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    // Send welcome DM only on fresh installs — re-auth (e.g., an
    // already-onboarded admin granting user_scope from the channels
    // page) shouldn't get spammed with the intro every time. Treat
    // either an existing session OR an explicit return_to as the
    // "this is a re-auth" signal.
    const stateReturnToForGate = searchParams.get("state");
    const isReAuth = !!loggedInUser || (!!stateReturnToForGate && stateReturnToForGate.startsWith("/"));
    if (!isReAuth) {
      try {
        const client = getSlackClient(botToken);

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
    }

    // 1. Explicit return_to via Slack's `state` round-trip is the
    //    deterministic signal — used by the channels-page "Connect
    //    Slack" button. Restricted to same-origin paths so the
    //    parameter can't be turned into an open-redirect vector.
    // 2. Falling back to the loggedInUser branch covers older callers
    //    that haven't been updated to pass return_to.
    // 3. Otherwise (fresh install) go through /setup for the
    //    default-channel + pricing onboarding.
    const stateReturnTo = searchParams.get("state");
    if (stateReturnTo && stateReturnTo.startsWith("/") && !stateReturnTo.startsWith("//")) {
      return NextResponse.redirect(`${APP_URL}${stateReturnTo}`);
    }
    if (loggedInUser) {
      return NextResponse.redirect(`${APP_URL}/admin/channels`);
    }
    return NextResponse.redirect(
      `${APP_URL}/setup?workspace=${encodeURIComponent(teamName)}&team_id=${teamId}`
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    const errorMessage = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(`${APP_URL}?error=server_error&reason=${encodeURIComponent(errorMessage)}`);
  }
}
