import { prisma } from "@/lib/db";

/**
 * Google API plumbing — token refresh, scope checks, and helpers for
 * calling Google APIs (Calendar, etc.) on the user's behalf. Reads
 * the stored refresh token from `User`, swaps it for a fresh access
 * token when the current one is expired, and writes the new
 * expiry back to the DB so we don't churn refresh calls.
 */

/**
 * Scopes the pre-call research applet needs. Used both when
 * constructing the OAuth URL and when checking whether an
 * already-logged-in user must be sent through a re-consent flow.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export function hasGoogleCalendarScope(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const granted = new Set(grantedScopes.split(/\s+/).filter(Boolean));
  // Either of the calendar scopes lets us read events; require at
  // least one rather than both because Google occasionally collapses
  // overlapping scopes.
  return GOOGLE_CALENDAR_SCOPES.some((s) => granted.has(s));
}

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/**
 * Returns a valid Google access token for the user, refreshing
 * through the stored refresh token when the cached one is expired or
 * within 60s of expiring. Returns null if the user has no refresh
 * token (i.e. needs re-consent) or the refresh call fails.
 */
export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  });

  if (!user?.googleRefreshToken) return null;

  const now = Date.now();
  const expiresAt = user.googleTokenExpiresAt?.getTime() ?? 0;
  if (user.googleAccessToken && expiresAt > now + 60_000) {
    return user.googleAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[Google] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
    return null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: user.googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    // Refresh tokens go bad when the user revokes access or changes
    // password. Clear them so the UI prompts re-auth on next call.
    const body = await res.text();
    console.error("[Google] Refresh token exchange failed:", res.status, body.slice(0, 300));
    if (res.status === 400 || res.status === 401) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          googleAccessToken: null,
          googleRefreshToken: null,
          googleTokenExpiresAt: null,
        },
      });
    }
    return null;
  }

  const data = (await res.json()) as GoogleRefreshResponse;
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      googleAccessToken: data.access_token,
      googleTokenExpiresAt: newExpiresAt,
      ...(data.scope ? { googleScopes: data.scope } : {}),
    },
  });

  return data.access_token;
}
