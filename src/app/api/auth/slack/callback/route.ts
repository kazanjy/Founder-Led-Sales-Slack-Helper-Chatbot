import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

/**
 * Handles Slack OAuth callback for web login
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

    // Find or create the user
    let user = await prisma.user.findUnique({
      where: {
        slackUserId_workspaceId: {
          slackUserId,
          workspaceId: workspace.id,
        },
      },
    });

    if (!user) {
      // Create user with trial status
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
    } else {
      // Update user info if changed
      await prisma.user.update({
        where: { id: user.id },
        data: {
          slackUserName: identityData.user?.name || user.slackUserName,
          slackEmail: identityData.user?.email || user.slackEmail,
        },
      });
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

    // Redirect to chat
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/chat`);
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=auth_error`
    );
  }
}
