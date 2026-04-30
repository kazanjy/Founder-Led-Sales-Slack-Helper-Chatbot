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
      where: {
        sessionId: id,
        metricDefinition: { archived: false },
      },
      include: {
        metricDefinition: true,
      },
      orderBy: { metricDefinition: { order: "asc" } },
    });

    // For each entry, look up the most recent prior session's value for
    // the same metric so the UI can show "Last session: X" alongside the
    // new input. Prior == any earlier-dated non-draft session belonging
    // to this user (createdAt is the tiebreaker for same-date sessions).
    // Drafts are excluded because the create-session flow seeds an
    // auto-saved draft with currentValue=0 for every metric, which
    // would otherwise be returned as the "prior" value and stomp the
    // real previous session.
    const previousByDefId: Record<string, number> = {};
    if (entries.length > 0) {
      const defIds = entries.map((e) => e.metricDefinitionId);
      const priorEntries = await prisma.coachingMetricEntry.findMany({
        where: {
          userId: user.id,
          metricDefinitionId: { in: defIds },
          sessionId: { not: id },
          session: {
            notes: { not: "(draft)" },
            OR: [
              { sessionDate: { lt: session.sessionDate } },
              {
                AND: [
                  { sessionDate: session.sessionDate },
                  { createdAt: { lt: session.createdAt } },
                ],
              },
            ],
          },
        },
        orderBy: [
          { session: { sessionDate: "desc" } },
          { session: { createdAt: "desc" } },
        ],
        include: { session: { select: { sessionDate: true, createdAt: true } } },
      });
      for (const pe of priorEntries) {
        if (previousByDefId[pe.metricDefinitionId] === undefined) {
          previousByDefId[pe.metricDefinitionId] = pe.currentValue;
        }
      }
    }

    const entriesWithPrev = entries.map((e) => ({
      ...e,
      previousValue: previousByDefId[e.metricDefinitionId] ?? null,
    }));

    return NextResponse.json({ entries: entriesWithPrev });
  } catch (error) {
    console.error("Error fetching session metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch session metrics" },
      { status: 500 }
    );
  }
}
