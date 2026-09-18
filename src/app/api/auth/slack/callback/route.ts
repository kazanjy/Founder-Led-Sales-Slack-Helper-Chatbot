import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { findOrCreateAccountForUser } from "@/lib/accounts";

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
    console.log("[Slack Auth] Step 1: Checking logged-in user");
    const loggedInUser = await getLoggedInUser();
    console.log("[Slack Auth] Step 1 done, loggedIn:", !!loggedInUser);

    // Exchange code for token
    console.log("[Slack Auth] Step 2: Exchanging code for token");
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
    console.log("[Slack Auth] Step 2 done, ok:", tokenData.ok, "team:", tokenData.team?.id);

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
    console.log("[Slack Auth] Step 3: Getting user identity for", slackUserId);
    const identityResponse = await fetch(
      "https://slack.com/api/users.identity",
      {
        headers: {
          Authorization: `Bearer ${tokenData.authed_user.access_token}`,
        },
      }
    );

    const identityData = await identityResponse.json();
    console.log("[Slack Auth] Step 3 done, identity ok:", identityData.ok, "email:", identityData.user?.email);

    // Find the workspace
    console.log("[Slack Auth] Step 4: Finding workspace for team", slackTeamId);
    const workspace = await prisma.workspace.findUnique({
      where: { slackTeamId },
    });
    console.log("[Slack Auth] Step 4 done, workspace:", workspace?.id || "NOT FOUND");

    // If workspace not found, try to match by email — the user may have been
    // created via a shared channel in a different workspace.
    if (!workspace) {
      const slackEmail = identityData.user?.email;
      if (slackEmail) {
        console.log("[Slack Auth] Workspace not found, trying email fallback:", slackEmail);
        const emailUser = await prisma.user.findFirst({
          where: {
            OR: [
              { slackEmail },
              { email: slackEmail },
            ],
          },
        });

        if (emailUser) {
          console.log("[Slack Auth] Email fallback matched user:", emailUser.id);

          // If already logged in, just redirect
          if (loggedInUser && loggedInUser.id === emailUser.id) {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/chat`);
          }

          // Create session for the matched user
          const sessionToken = randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          await prisma.session.create({
            data: {
              userId: emailUser.id,
              token: sessionToken,
              expiresAt,
            },
          });

          const cookieStore = await cookies();
          cookieStore.set("session", sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            expires: expiresAt,
            path: "/",
          });

          console.log("[Slack Auth] Email fallback login successful for user:", emailUser.id);
          return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/chat`);
        }
      }

      // No workspace and no email match — truly not found
      console.log("[Slack Auth] No workspace and no email match for team", slackTeamId);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=workspace_not_found`
      );
    }

    // Check if this Slack identity is already linked to another user
    console.log("[Slack Auth] Step 5: Looking up existing user", slackUserId, "in workspace", workspace.id);
    const existingSlackUser = await prisma.user.findUnique({
      where: {
        slackUserId_workspaceId: {
          slackUserId,
          workspaceId: workspace.id,
        },
      },
    });
    console.log("[Slack Auth] Step 5 done, existingUser:", existingSlackUser?.id || "NONE");

    let user;
    let isNewUser = false;

    console.log("[Slack Auth] Step 6: Resolving user (loggedIn:", !!loggedInUser, "existingSlack:", !!existingSlackUser, ")");
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

      // Lazy migration: assign account if solo user
      const existingEmail = identityData.user?.email || existingSlackUser.slackEmail || existingSlackUser.email;
      if (!user.accountId && existingEmail) {
        user = await findOrCreateAccountForUser(user.id, existingEmail, identityData.user?.name || user.name);
        console.log(`[Slack Auth] Lazy-migrated solo user ${user.id} to account ${user.accountId}`);
      }
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

      // Auto-create or join an Account (if we have an email)
      const slackEmail = identityData.user?.email;
      if (slackEmail) {
        user = await findOrCreateAccountForUser(user.id, slackEmail, identityData.user?.name);
      }
    }

    console.log("[Slack Auth] Step 7: Creating session for user", user.id, "isNew:", isNewUser);
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

    console.log("[Slack Auth] Step 8: Session created, setting cookie and redirecting");
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
