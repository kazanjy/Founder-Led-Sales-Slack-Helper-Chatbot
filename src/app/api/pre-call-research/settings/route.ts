import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const VALID_MODES = new Set(["all_external", "title_match", "off"]);
const VALID_DESTINATIONS = new Set(["dm", "channel"]);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      preCallResearchMode: true,
      preCallResearchDestination: true,
      preCallResearchMutedDomains: true,
      preferredResearchSlackChannelId: true,
      preferredResearchSlackChannelName: true,
    },
  });
  return NextResponse.json({
    mode: row?.preCallResearchMode || "all_external",
    destination: row?.preCallResearchDestination || "dm",
    mutedDomains: row?.preCallResearchMutedDomains || [],
    channelId: row?.preferredResearchSlackChannelId || null,
    channelName: row?.preferredResearchSlackChannelName || null,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { mode, destination, mutedDomains, channelId, channelName } = await request.json();

  const update: Record<string, unknown> = {};
  if (mode !== undefined) {
    if (!VALID_MODES.has(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    update.preCallResearchMode = mode;
  }
  if (destination !== undefined) {
    if (!VALID_DESTINATIONS.has(destination)) {
      return NextResponse.json({ error: "Invalid destination" }, { status: 400 });
    }
    update.preCallResearchDestination = destination;
  }
  if (Array.isArray(mutedDomains)) {
    update.preCallResearchMutedDomains = mutedDomains
      .filter((d) => typeof d === "string" && d.trim())
      .map((d) => d.trim().toLowerCase());
  }
  if (channelId !== undefined) {
    update.preferredResearchSlackChannelId = channelId || null;
  }
  if (channelName !== undefined) {
    update.preferredResearchSlackChannelName = channelName || null;
  }

  await prisma.user.update({ where: { id: user.id }, data: update });
  return NextResponse.json({ ok: true });
}
