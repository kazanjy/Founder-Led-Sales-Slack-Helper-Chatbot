import { NextRequest, NextResponse } from "next/server";

/**
 * Initiates Google OAuth for web login. Accepts an optional
 * `?returnTo=/path` query param so callers (e.g. the pre-call
 * research page asking the user to grant Calendar scopes) can land
 * the user back where they started instead of the default /chat or
 * /upgrade. The path is round-tripped through Google's `state`
 * parameter and validated on the callback to prevent open redirects.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  if (!clientId) {
    console.error("GOOGLE_CLIENT_ID not configured");
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=google_not_configured`
    );
  }

  // Identity scopes power the login flow; calendar.readonly +
  // calendar.events.readonly let the pre-call research applet pull a
  // user's upcoming external meetings so we can prefill prospect
  // research from real bookings.
  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
  ].join(" ");

  // Same-origin path allow-list: must start with "/" and not "//".
  // Reject anything else so a malicious `returnTo` can't be used as
  // an open redirect.
  const rawReturnTo = request.nextUrl.searchParams.get("returnTo") || "";
  const returnTo =
    rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : "";

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", scopes);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");
  if (returnTo) {
    googleAuthUrl.searchParams.set(
      "state",
      Buffer.from(JSON.stringify({ returnTo })).toString("base64url")
    );
  }

  return NextResponse.redirect(googleAuthUrl.toString());
}
