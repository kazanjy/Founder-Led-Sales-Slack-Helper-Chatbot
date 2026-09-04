import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/meeting-recorder/encryption";
import { refreshFathomToken } from "@/lib/meeting-recorder/fathom";
import { refreshCirclebackToken } from "@/lib/meeting-recorder/circleback";
import type { MeetingRecorderConnection } from "@prisma/client";

/**
 * Get a usable, decrypted access token for a recorder connection,
 * proactively refreshing if it's known-expired. Mirrors the logic
 * in /api/meeting-recorder/calls/route.ts so the cron + discover +
 * enrich paths don't 401 against Fathom whenever the OAuth token
 * rolls over.
 */
export async function getRecorderAccessToken(
  conn: MeetingRecorderConnection
): Promise<string> {
  let token = decrypt(conn.accessToken);

  const expired = conn.tokenExpiresAt && conn.tokenExpiresAt < new Date();
  if (expired && conn.refreshToken) {
    const refreshed = await tryRefresh(conn);
    if (refreshed) token = refreshed;
  }

  return token;
}

/**
 * Wrap a recorder API call so we automatically retry once after a
 * token refresh if the first attempt fails with a 401. Returns the
 * call's result. If refresh fails or the retry still 401s, the
 * original error is re-thrown.
 */
export async function withRecorderTokenRefresh<T>(
  conn: MeetingRecorderConnection,
  fn: (apiKey: string) => Promise<T>
): Promise<T> {
  let apiKey = await getRecorderAccessToken(conn);
  try {
    return await fn(apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const looksLike401 = message.includes("401") || message.includes("403");
    if (!looksLike401 || !conn.refreshToken) throw err;
    const refreshed = await tryRefresh(conn);
    if (!refreshed) throw err;
    apiKey = refreshed;
    return await fn(apiKey);
  }
}

async function tryRefresh(conn: MeetingRecorderConnection): Promise<string | null> {
  if (!conn.refreshToken) return null;
  try {
    let refreshed: { access_token: string; refresh_token?: string; expires_in?: number } | null = null;
    if (conn.provider === "fathom") {
      refreshed = await refreshFathomToken(decrypt(conn.refreshToken));
    } else if (conn.provider === "circleback") {
      // Circleback uses RFC 7591 dynamic client registration — the
      // per-user clientId (and optional secret) live on the connection
      // row, persisted at OAuth-callback time.
      if (!conn.providerClientId) {
        console.warn(
          `[recorder] circleback refresh skipped — no providerClientId on connection ${conn.id}; user must reconnect`
        );
        return null;
      }
      refreshed = await refreshCirclebackToken({
        refreshToken: decrypt(conn.refreshToken),
        clientId: decrypt(conn.providerClientId),
        clientSecret: conn.providerClientSecret
          ? decrypt(conn.providerClientSecret)
          : undefined,
      });
    }
    if (!refreshed) return null;
    await prisma.meetingRecorderConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: encrypt(refreshed.access_token),
        refreshToken: refreshed.refresh_token
          ? encrypt(refreshed.refresh_token)
          : conn.refreshToken,
        tokenExpiresAt: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : null,
      },
    });
    console.log(`[recorder] token refreshed for ${conn.provider}`);
    return refreshed.access_token;
  } catch (err) {
    console.error(`[recorder] token refresh failed for ${conn.provider}:`, err);
    return null;
  }
}
