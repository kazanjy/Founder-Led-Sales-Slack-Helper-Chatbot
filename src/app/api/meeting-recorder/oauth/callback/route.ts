import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { encrypt } from "@/lib/meeting-recorder/encryption";
import { exchangeFathomCode } from "@/lib/meeting-recorder/fathom";

// GET — OAuth callback handler
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(new URL("/?error=not_logged_in", request.url));
    }

    const code = request.nextUrl.searchParams.get("code");
    const stateParam = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");

    if (error) {
      console.error("OAuth error from provider:", error);
      return NextResponse.redirect(new URL("/call-review?error=oauth_denied", request.url));
    }

    if (!code || !stateParam) {
      return NextResponse.redirect(new URL("/call-review?error=oauth_missing_params", request.url));
    }

    // Parse state
    let state: { provider: string; userId: string; returnTo: string };
    try {
      state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    } catch {
      return NextResponse.redirect(new URL("/call-review?error=oauth_invalid_state", request.url));
    }

    // Verify user matches
    if (state.userId !== user.id) {
      return NextResponse.redirect(new URL("/call-review?error=oauth_user_mismatch", request.url));
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
    const redirectUri = `${appUrl}/api/meeting-recorder/oauth/callback`;

    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number | undefined;

    // Exchange code for tokens based on provider
    switch (state.provider) {
      case "fathom": {
        const tokens = await exchangeFathomCode(code, redirectUri);
        accessToken = tokens.access_token;
        refreshToken = tokens.refresh_token;
        expiresIn = tokens.expires_in;
        break;
      }
      default:
        return NextResponse.redirect(new URL(`${state.returnTo}?error=unknown_provider`, request.url));
    }

    // Store encrypted tokens
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

    await prisma.meetingRecorderConnection.upsert({
      where: {
        userId_provider: { userId: user.id, provider: state.provider },
      },
      update: {
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        tokenExpiresAt,
        status: "active",
        connectedAt: new Date(),
      },
      create: {
        userId: user.id,
        provider: state.provider,
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        tokenExpiresAt,
        status: "active",
      },
    });

    // Redirect back to the originating page
    return NextResponse.redirect(new URL(`${state.returnTo}?connected=${state.provider}`, request.url));
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(new URL("/call-review?error=oauth_failed", request.url));
  }
}
