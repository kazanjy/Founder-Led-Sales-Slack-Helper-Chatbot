import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFathomAuthUrl } from "@/lib/meeting-recorder/fathom";
import crypto from "crypto";

// GET — initiate OAuth flow for a provider
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const provider = request.nextUrl.searchParams.get("provider");
    const returnTo = request.nextUrl.searchParams.get("returnTo") || "/call-review";

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

    switch (provider) {
      case "fathom":
        authUrl = getFathomAuthUrl(redirectUri, state);
        break;
      default:
        return NextResponse.json({ error: `OAuth not supported for ${provider}` }, { status: 400 });
    }

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Error initiating OAuth:", error);
    return NextResponse.json({ error: "Failed to start OAuth" }, { status: 500 });
  }
}
