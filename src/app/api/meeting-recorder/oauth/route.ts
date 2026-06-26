import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFathomAuthUrl } from "@/lib/meeting-recorder/fathom";
import {
  registerCirclebackClient,
  buildCirclebackAuthUrl,
  generatePkce,
  generateOauthState,
} from "@/lib/meeting-recorder/circleback";
import crypto from "crypto";

// Cookie name used to thread the PKCE verifier + dynamically-registered
// client credentials from the start of the Circleback OAuth flow into
// the callback. Cookie is keyed by the OAuth state nonce so multiple
// concurrent flows don't collide. HttpOnly + Secure + sameSite=lax so
// the redirect from circleback.ai brings it back to us. 10-minute
// lifetime — comfortably longer than the user's authorize click but
// short enough that orphaned cookies expire on their own.
const CIRCLEBACK_COOKIE_PREFIX = "cb-oauth-";
const CIRCLEBACK_COOKIE_TTL_SECONDS = 60 * 10;

// GET — initiate OAuth flow for a provider
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const provider = request.nextUrl.searchParams.get("provider");
    const returnTo = request.nextUrl.searchParams.get("returnTo") || "/integrations";

    if (!provider) {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
    const redirectUri = `${appUrl}/api/meeting-recorder/oauth/callback`;

    // State includes provider, user ID, and return URL for security + routing
    const state = Buffer.from(JSON.stringify({
      provider,
      userId: user.id,
      returnTo,
      nonce: crypto.randomBytes(16).toString("hex"),
    })).toString("base64url");

    let authUrl: string;
    let cookieToSet: { name: string; value: string } | null = null;

    switch (provider) {
      case "fathom":
        authUrl = getFathomAuthUrl(redirectUri, state);
        break;
      case "circleback": {
        // 1. Dynamic client registration. We register fresh every
        //    time — orphaned clients at Circleback are cheap, and
        //    caching would need a schema migration.
        const registration = await registerCirclebackClient(redirectUri);
        // 2. PKCE + nonce.
        const { verifier, challenge } = generatePkce();
        const cookieNonce = generateOauthState();
        // 3. Build the authorize URL using the OAuth-flow state we
        //    already built above, so the callback's existing state
        //    parsing still recognizes the user + return path.
        authUrl = buildCirclebackAuthUrl({
          clientId: registration.client_id,
          redirectUri,
          codeChallenge: challenge,
          state,
        });
        // 4. Stash the verifier + client creds in a cookie keyed by
        //    a fresh nonce we put on the cookie name. We pass the
        //    nonce through the state so the callback can find the
        //    cookie. (We can't put the verifier in state itself —
        //    that defeats PKCE.)
        const wrappedState = Buffer.from(
          JSON.stringify({
            inner: state,
            cookieNonce,
          })
        ).toString("base64url");
        // Replace the authorize URL's state with the wrapped form
        // that carries the cookie nonce.
        const url = new URL(authUrl);
        url.searchParams.set("state", wrappedState);
        authUrl = url.toString();
        cookieToSet = {
          name: `${CIRCLEBACK_COOKIE_PREFIX}${cookieNonce}`,
          value: JSON.stringify({
            verifier,
            clientId: registration.client_id,
            clientSecret: registration.client_secret || null,
          }),
        };
        break;
      }
      default:
        return NextResponse.json({ error: `OAuth not supported for ${provider}` }, { status: 400 });
    }

    const response = NextResponse.redirect(authUrl);
    if (cookieToSet) {
      response.cookies.set(cookieToSet.name, cookieToSet.value, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api/meeting-recorder/oauth",
        maxAge: CIRCLEBACK_COOKIE_TTL_SECONDS,
      });
    }
    return response;
  } catch (error) {
    console.error("Error initiating OAuth:", error);
    return NextResponse.json({ error: "Failed to start OAuth" }, { status: 500 });
  }
}
