import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET  — list the current user's saved title-pattern automations.
 * POST — create a new pattern.
 *
 * Each pattern tells the daily cron: "if a calendar event matches
 * <titlePattern>, run pre-call research and post the brief to
 * <destination>".
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const patterns = await prisma.recurringResearchPattern.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ patterns });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await request.json()) as {
    titlePattern?: string;
    destination?: "dm" | "channel";
    channelId?: string | null;
    channelName?: string | null;
  };
  const titlePattern = (body.titlePattern || "").trim();
  if (!titlePattern) {
    return NextResponse.json({ error: "titlePattern required" }, { status: 400 });
  }
  const destination = body.destination === "channel" ? "channel" : "dm";
  if (destination === "channel" && !body.channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  const pattern = await prisma.recurringResearchPattern.create({
    data: {
      userId: user.id,
      titlePattern,
      destination,
      channelId: destination === "channel" ? body.channelId : null,
      channelName: destination === "channel" ? body.channelName || null : null,
      enabled: true,
    },
  });

  return NextResponse.json({ pattern });
}
