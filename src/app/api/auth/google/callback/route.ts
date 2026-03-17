import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { findOrCreateAccountForUser } from "@/lib/accounts";

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
}

/**
 * Handles Google OAuth callback
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("Google auth error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=google_auth_failed`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=no_code`
    );
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      }),
    });

    const tokenData: GoogleTokenResponse = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=token_exchange_failed`
      );
    }

    // Get user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const userInfo: GoogleUserInfo = await userInfoResponse.json();

    if (!userInfo.id || !userInfo.email) {
      console.error("Missing user info:", userInfo);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=missing_user_info`
      );
    }

    // Find existing user by Google ID, email, slackEmail, or secondaryEmails
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: userInfo.id },
          { email: userInfo.email },
          { slackEmail: userInfo.email },
          { secondaryEmails: { has: userInfo.email } },
        ],
      },
    });

    let isNewUser = false;

    if (!user) {
      // Create new web-only user
      user = await prisma.user.create({
        data: {
          googleId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          avatarUrl: userInfo.picture,
          trialStartedAt: new Date(),
          licenseStatus: "TRIAL",
        },
      });
      isNewUser = true;
      console.log(`[Google Auth] Created new user: ${userInfo.email}`);

      // Auto-create or join an Account
      user = await findOrCreateAccountForUser(user.id, userInfo.email, userInfo.name);
    } else {
      // Update existing user with Google info if not already set
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: user.googleId || userInfo.id,
          email: user.email || userInfo.email,
          name: user.name || userInfo.name,
          avatarUrl: user.avatarUrl || userInfo.picture,
        },
      });
      console.log(`[Google Auth] Existing user logged in: ${userInfo.email}`);

      // Lazy migration: assign account if solo user
      if (!user.accountId) {
        user = await findOrCreateAccountForUser(user.id, userInfo.email, userInfo.name);
        console.log(`[Google Auth] Lazy-migrated solo user ${user.id} to account ${user.accountId}`);
      }
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
    console.error("Google auth callback error:", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=auth_error`
    );
  }
}
