import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canEditOwnedBy } from "@/lib/coaching/access";

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

    // Sections are layout markers, not data — they never have entries.
    if (metric.kind === "section") {
      return NextResponse.json(
        { error: "Cannot create entries for a section" },
        { status: 400 }
      );
    }

    const allowed = await canEditOwnedBy(user.id, metric.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { sessionId, currentValue } = body;

    // Check if an entry already exists for this metric + session
    const existingEntry = await prisma.coachingMetricEntry.findFirst({
      where: { metricDefinitionId: id, sessionId },
    });

    // Resolve the chronologically-prior non-draft session's entry for
    // this metric so the stored delta matches the "Last session" value
    // the GET endpoint surfaces. Previously this used createdAt: desc
    // which picked the most-recently-CREATED entry — fine when sessions
    // are entered in order, wrong the moment the user backfills an
    // earlier session or re-creates an old one.
    const currentSession = await prisma.coachingSession.findUnique({
      where: { id: sessionId },
      select: { sessionDate: true, createdAt: true },
    });

    const previousEntry = currentSession
      ? await prisma.coachingMetricEntry.findFirst({
          where: {
            metricDefinitionId: id,
            sessionId: { not: sessionId },
            session: {
              notes: { not: "(draft)" },
              OR: [
                { sessionDate: { lt: currentSession.sessionDate } },
                {
                  AND: [
                    { sessionDate: currentSession.sessionDate },
                    { createdAt: { lt: currentSession.createdAt } },
                  ],
                },
              ],
            },
          },
          orderBy: [
            { session: { sessionDate: "desc" } },
            { session: { createdAt: "desc" } },
          ],
        })
      : null;

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
