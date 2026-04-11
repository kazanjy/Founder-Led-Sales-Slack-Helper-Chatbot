import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { decrypt } from "@/lib/meeting-recorder/encryption";
import { getProvider } from "@/lib/meeting-recorder/providers";

// GET — list recent calls from connected provider
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const providerSlug = request.nextUrl.searchParams.get("provider");

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
        const apiKey = decrypt(conn.accessToken);
        const calls = await provider.listCalls(apiKey, 15);

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
        // If auth failed, mark connection as expired
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
