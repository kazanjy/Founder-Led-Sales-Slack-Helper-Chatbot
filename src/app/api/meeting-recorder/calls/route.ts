import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/meeting-recorder/encryption";
import { getProvider } from "@/lib/meeting-recorder/providers";
import { refreshFathomToken } from "@/lib/meeting-recorder/fathom";

// Helper: try to refresh an OAuth token, returns new access token or null
async function tryRefreshToken(conn: { id: string; provider: string; refreshToken: string | null }): Promise<string | null> {
  if (!conn.refreshToken) return null;
  try {
    console.log(`[MeetingRecorder] Refreshing token for ${conn.provider}...`);
    const refreshed = conn.provider === "fathom"
      ? await refreshFathomToken(decrypt(conn.refreshToken))
      : null;

    if (refreshed) {
      await prisma.meetingRecorderConnection.update({
        where: { id: conn.id },
        data: {
          accessToken: encrypt(refreshed.access_token),
          refreshToken: refreshed.refresh_token ? encrypt(refreshed.refresh_token) : conn.refreshToken,
          tokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
        },
      });
      console.log(`[MeetingRecorder] Token refreshed for ${conn.provider}`);
      return refreshed.access_token;
    }
  } catch (error) {
    console.error(`[MeetingRecorder] Token refresh failed for ${conn.provider}:`, error);
  }
  return null;
}

// GET — list recent calls from connected provider
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const providerSlug = request.nextUrl.searchParams.get("provider");
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "15", 10) || 15, 500);

    // Find active connection(s)
    const connections = await prisma.meetingRecorderConnection.findMany({
      where: {
        userId: user.id,
        status: "active",
        ...(providerSlug ? { provider: providerSlug } : {}),
      },
    });

    if (connections.length === 0) {
      return NextResponse.json({ calls: [], connected: false });
    }

    // Fetch calls from each connected provider
    const allCalls: Array<{ provider: string; providerName: string; calls: unknown[] }> = [];

    for (const conn of connections) {
      const provider = getProvider(conn.provider);
      if (!provider) continue;

      try {
        let apiKey = decrypt(conn.accessToken);

        // Proactively refresh if we know the token is expired
        if (conn.tokenExpiresAt && conn.tokenExpiresAt < new Date() && conn.refreshToken) {
          const refreshed = await tryRefreshToken(conn);
          if (refreshed) apiKey = refreshed;
        }

        console.log(`[MeetingRecorder] Fetching calls from ${conn.provider} (limit: ${limit})`);
        let calls;
        try {
          calls = await provider.listCalls(apiKey, limit);
        } catch (firstError) {
          // On 401, try refreshing the token and retrying once
          if (conn.refreshToken && firstError instanceof Error && firstError.message.includes("401")) {
            console.log(`[MeetingRecorder] Got 401 from ${conn.provider}, attempting token refresh...`);
            const refreshed = await tryRefreshToken(conn);
            if (refreshed) {
              apiKey = refreshed;
              calls = await provider.listCalls(apiKey, limit);
            } else {
              throw firstError;
            }
          } else {
            throw firstError;
          }
        }
        console.log(`[MeetingRecorder] Got ${calls.length} calls from ${conn.provider}`);

        allCalls.push({
          provider: conn.provider,
          providerName: provider.name,
          calls,
        });

        // Update lastSyncedAt
        await prisma.meetingRecorderConnection.update({
          where: { id: conn.id },
          data: { lastSyncedAt: new Date() },
        }).catch(() => {});
      } catch (error) {
        console.error(`Error fetching calls from ${conn.provider}:`, error);
        // If auth failed after refresh attempt, mark connection as expired
        if (error instanceof Error && error.message.includes("401")) {
          await prisma.meetingRecorderConnection.update({
            where: { id: conn.id },
            data: { status: "expired" },
          }).catch(() => {});
        }
      }
    }

    return NextResponse.json({ calls: allCalls, connected: true });
  } catch (error) {
    console.error("Error fetching calls:", error);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }
}
