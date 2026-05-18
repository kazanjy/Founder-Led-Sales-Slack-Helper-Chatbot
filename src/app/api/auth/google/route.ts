import { NextResponse } from "next/server";

/**
 * Initiates Google OAuth for web login
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  if (!clientId) {
    console.error("GOOGLE_CLIENT_ID not configured");
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=google_not_configured`
    );
  }

  // Google OAuth scopes. Identity scopes power the login flow;
  // calendar.readonly + calendar.events.readonly let the pre-call
  // research applet pull a user's upcoming external meetings so we
  // can prefill prospect research from real bookings. Adding the
  // calendar scopes here means a new login already arrives with
  // everything we need; existing Google-authed users will go through
  // a one-time re-consent (handled by GOOGLE_SCOPE_VERSION on the
  // user record).
  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
  ].join(" ");

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", scopes);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(googleAuthUrl.toString());
}
