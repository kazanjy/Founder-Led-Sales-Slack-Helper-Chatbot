import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

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

/**
 * Handles Slack OAuth callback for web login
 * - If user is already logged in (e.g., Google user), links Slack to existing account
 * - If not logged in, creates new account or logs into existing Slack account
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("Slack auth error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=auth_failed`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=no_code`
    );
  }

  try {
    // Check if user is already logged in (e.g., Google user adding Slack)
    const loggedInUser = await getLoggedInUser();

    // Exchange code for token
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/slack/callback`,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.ok) {
      console.error("Token exchange failed:", tokenData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=token_exchange_failed`
      );
    }

    // Extract user info from the authed_user object
    const slackUserId = tokenData.authed_user?.id;
    const slackTeamId = tokenData.team?.id;

    if (!slackUserId || !slackTeamId) {
      console.error("Missing user or team ID:", tokenData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=missing_user_info`
      );
    }

    // Get user identity details
    const identityResponse = await fetch(
      "https://slack.com/api/users.identity",
      {
        headers: {
          Authorization: `Bearer ${tokenData.authed_user.access_token}`,
        },
      }
    );

    const identityData = await identityResponse.json();

    // Find the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { slackTeamId },
    });

    if (!workspace) {
      // User's workspace hasn't installed Mikey yet
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=workspace_not_found`
      );
    }

    // Check if this Slack identity is already linked to another user
    const existingSlackUser = await prisma.user.findUnique({
      where: {
        slackUserId_workspaceId: {
          slackUserId,
          workspaceId: workspace.id,
        },
      },
    });

    let user;
    let isNewUser = false;

    if (loggedInUser) {
      // User is already logged in (e.g., Google user adding Slack)
      if (existingSlackUser && existingSlackUser.id !== loggedInUser.id) {
        // This Slack identity is already linked to a different account
        console.error(
          `Slack identity conflict: ${slackUserId} already linked to user ${existingSlackUser.id}, but logged in as ${loggedInUser.id}`
        );
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL}/chat?error=slack_already_linked`
        );
      }

      // Link Slack to the existing logged-in user
      user = await prisma.user.update({
        where: { id: loggedInUser.id },
        data: {
          slackUserId,
          workspaceId: workspace.id,
          slackUserName: identityData.user?.name || loggedInUser.slackUserName,
          slackEmail: identityData.user?.email || loggedInUser.slackEmail,
        },
      });
      console.log(
        `[Slack Auth] Linked Slack to existing user: ${loggedInUser.id}`
      );

      // Already has a session, just redirect
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/chat`);
    }

    // Not logged in - normal Slack login flow
    if (existingSlackUser) {
      // Update existing user info
      user = await prisma.user.update({
        where: { id: existingSlackUser.id },
        data: {
          slackUserName:
            identityData.user?.name || existingSlackUser.slackUserName,
          slackEmail: identityData.user?.email || existingSlackUser.slackEmail,
        },
      });
    } else {
      // Create new user with trial status
      user = await prisma.user.create({
        data: {
          slackUserId,
          workspaceId: workspace.id,
          slackUserName: identityData.user?.name || null,
          slackEmail: identityData.user?.email || null,
          trialStartedAt: new Date(),
          licenseStatus: "TRIAL",
        },
      });
      isNewUser = true;
    }

    // Create session
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

    // Redirect new users to upgrade page, existing users to chat
    const redirectUrl = isNewUser
      ? `${process.env.NEXT_PUBLIC_APP_URL}/upgrade`
      : `${process.env.NEXT_PUBLIC_APP_URL}/chat`;
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("Auth callback error:", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=auth_error`
    );
  }
}
