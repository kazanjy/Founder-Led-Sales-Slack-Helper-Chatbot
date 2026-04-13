import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const metric = await prisma.coachingMetricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    // Allow same-account access
    if (metric.userId !== user.id) {
      if (!user.accountId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      const owner = await prisma.user.findFirst({ where: { id: metric.userId, accountId: user.accountId }, select: { id: true } });
      if (!owner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { sessionId, currentValue } = body;

    // Check if an entry already exists for this metric + session
    const existingEntry = await prisma.coachingMetricEntry.findFirst({
      where: { metricDefinitionId: id, sessionId },
    });

    // Find the previous entry from a DIFFERENT session for addedSinceLastSession
    const previousEntry = await prisma.coachingMetricEntry.findFirst({
      where: { metricDefinitionId: id, sessionId: { not: sessionId } },
      orderBy: { createdAt: "desc" },
    });

    const addedSinceLastSession = previousEntry
      ? currentValue - previousEntry.currentValue
      : 0;

    let entry;
    if (existingEntry) {
      // Update existing entry instead of creating a duplicate
      entry = await prisma.coachingMetricEntry.update({
        where: { id: existingEntry.id },
        data: { currentValue, addedSinceLastSession },
      });
    } else {
      entry = await prisma.coachingMetricEntry.create({
        data: {
          userId: user.id,
          metricDefinitionId: id,
          sessionId,
          currentValue,
          addedSinceLastSession,
        },
      });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error recording metric entry:", error);
    return NextResponse.json(
      { error: "Failed to record metric entry" },
      { status: 500 }
    );
  }
}
