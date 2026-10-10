import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { decrypt } from "@/lib/meeting-recorder/encryption";
import { getProvider } from "@/lib/meeting-recorder/providers";

// GET — fetch full detail for a specific call (transcript + summary)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { callId } = await params;
    const providerSlug = request.nextUrl.searchParams.get("provider");

    if (!providerSlug) {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    const connection = await prisma.meetingRecorderConnection.findFirst({
      where: { userId: user.id, provider: providerSlug, status: "active" },
    });

    if (!connection) {
      return NextResponse.json({ error: "Not connected to this provider" }, { status: 400 });
    }

    const provider = getProvider(providerSlug);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    const apiKey = decrypt(connection.accessToken);
    const detail = await provider.getCallDetail(apiKey, callId);

    return NextResponse.json({ call: detail });
  } catch (error) {
    console.error("Error fetching call detail:", error);
    return NextResponse.json({ error: "Failed to fetch call detail" }, { status: 500 });
  }
}
