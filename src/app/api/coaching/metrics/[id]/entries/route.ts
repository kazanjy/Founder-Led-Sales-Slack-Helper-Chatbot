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

    const metric = await prisma.metricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    if (metric.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { sessionId, currentValue } = body;

    // Find the previous entry for this metric to calculate addedSinceLastSession
    const previousEntry = await prisma.metricEntry.findFirst({
      where: { metricId: id },
      orderBy: { createdAt: "desc" },
    });

    const addedSinceLastSession = previousEntry
      ? currentValue - previousEntry.currentValue
      : null;

    const entry = await prisma.metricEntry.create({
      data: {
        metricId: id,
        sessionId,
        currentValue,
        addedSinceLastSession,
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error recording metric entry:", error);
    return NextResponse.json(
      { error: "Failed to record metric entry" },
      { status: 500 }
    );
  }
}
