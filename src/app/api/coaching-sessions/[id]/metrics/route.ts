import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const session = await prisma.coachingSession.findUnique({
      where: { id },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const entries = await prisma.coachingMetricEntry.findMany({
      where: { sessionId: id },
      include: {
        metricDefinition: true,
      },
      orderBy: { metricDefinition: { order: "asc" } },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching session metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch session metrics" },
      { status: 500 }
    );
  }
}
