import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/meeting-recorder/encryption";
import { getProvider, getAllProviders } from "@/lib/meeting-recorder/providers";

// GET — list user's connections + available providers
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const connections = await prisma.meetingRecorderConnection.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
        lastSyncedAt: true,
      },
    });

    const available = getAllProviders().map((p) => ({
      slug: p.slug,
      name: p.name,
      icon: p.icon,
      authType: p.authType,
      connected: connections.some((c) => c.provider === p.slug && c.status === "active"),
    }));

    return NextResponse.json({ connections, available });
  } catch (error) {
    console.error("Error fetching connections:", error);
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }
}

// POST — connect a new provider (API key flow)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { provider: providerSlug, apiKey } = await request.json();

    if (!providerSlug || !apiKey) {
      return NextResponse.json({ error: "Provider and API key are required" }, { status: 400 });
    }

    const provider = getProvider(providerSlug);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    // Validate the key
    const validation = await provider.validateKey(apiKey);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error || "Invalid API key" }, { status: 400 });
    }

    // Encrypt and store
    const encryptedToken = encrypt(apiKey);

    const connection = await prisma.meetingRecorderConnection.upsert({
      where: {
        userId_provider: { userId: user.id, provider: providerSlug },
      },
      update: {
        accessToken: encryptedToken,
        status: "active",
        connectedAt: new Date(),
        providerAccountId: validation.accountId || null,
      },
      create: {
        userId: user.id,
        provider: providerSlug,
        accessToken: encryptedToken,
        status: "active",
        providerAccountId: validation.accountId || null,
      },
    });

    return NextResponse.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        status: connection.status,
        connectedAt: connection.connectedAt,
      },
    });
  } catch (error) {
    console.error("Error connecting provider:", error);
    return NextResponse.json({ error: "Failed to connect provider" }, { status: 500 });
  }
}
