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
    // new input, AND build a longer history list (up to 10 entries per
    // metric) so a hover popover can show the recent trend.
    // Prior == any earlier-dated non-draft session belonging to this
    // user (createdAt is the tiebreaker for same-date sessions). Drafts
    // are excluded because the create-session flow seeds an auto-saved
    // draft with currentValue=0 for every metric.
    const HISTORY_LIMIT = 10;
    const previousByDefId: Record<string, number> = {};
    const historyByDefId: Record<
      string,
      Array<{ sessionId: string; sessionTitle: string; sessionDate: string; value: number }>
    > = {};
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
        include: { session: { select: { id: true, title: true, sessionDate: true, createdAt: true } } },
      });
      for (const pe of priorEntries) {
        if (previousByDefId[pe.metricDefinitionId] === undefined) {
          previousByDefId[pe.metricDefinitionId] = pe.currentValue;
        }
        const arr = historyByDefId[pe.metricDefinitionId] ?? (historyByDefId[pe.metricDefinitionId] = []);
        if (arr.length < HISTORY_LIMIT) {
          arr.push({
            sessionId: pe.session.id,
            sessionTitle: pe.session.title,
            sessionDate: pe.session.sessionDate.toISOString(),
            value: pe.currentValue,
          });
        }
      }
    }

    const entriesWithPrev = entries.map((e) => ({
      ...e,
      previousValue: previousByDefId[e.metricDefinitionId] ?? null,
      history: historyByDefId[e.metricDefinitionId] ?? [],
    }));

    // Pull section markers (kind=section definitions) so the UI can
    // interleave them in order with the real metric entries. Sections
    // never have entries — they're rendered as full-width header
    // strips that visually group the tiles below them.
    const sections = await prisma.coachingMetricDefinition.findMany({
      where: { userId: session.userId, kind: "section", archived: false },
      orderBy: { order: "asc" },
    });

    // Splice sections into the entries array as pseudo-entries with
    // metricDefinition.kind="section" so the UI walks one ordered list.
    // The fake entry id ("section-<defId>") keeps React keys unique
    // and stable across renders.
    type Item = (typeof entriesWithPrev)[number] | {
      id: string;
      currentValue: number;
      addedSinceLastSession: number;
      previousValue: null;
      history: never[];
      metricDefinitionId: string;
      metricDefinition: typeof sections[number];
    };
    const sectionItems: Item[] = sections.map((s) => ({
      id: `section-${s.id}`,
      currentValue: 0,
      addedSinceLastSession: 0,
      previousValue: null,
      history: [],
      metricDefinitionId: s.id,
      metricDefinition: s,
    }));

    const items: Item[] = [...entriesWithPrev, ...sectionItems].sort(
      (a, b) => (a.metricDefinition.order ?? 0) - (b.metricDefinition.order ?? 0)
    );

    return NextResponse.json({ entries: items });
  } catch (error) {
    console.error("Error fetching session metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch session metrics" },
      { status: 500 }
    );
  }
}
