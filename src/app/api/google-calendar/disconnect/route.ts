import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/google-calendar/disconnect
 *
 * Clears the current user's stored Google OAuth refresh token + scopes
 * so /api/auth/me reports googleCalendarConnected: false on the next
 * load. Doesn't revoke the grant on Google's side — that's the user's
 * call from myaccount.google.com — but our app stops using their
 * calendar until they reconnect via /api/auth/google.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { googleRefreshToken: null, googleScopes: [] },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[google-calendar/disconnect] failed:", err);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
