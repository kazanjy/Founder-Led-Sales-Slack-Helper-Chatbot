import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list user's deals (newest first)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const [deals, lastActivity, nextMeeting, newSinceAnalysis] = await Promise.all([
      prisma.deal.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { entries: true, participants: true },
          },
          // Surface a few participant names per deal so the card can
          // merchandise WHO is on the deal, not just a count. Capped at
          // 8 because that's enough to fill two compact lines on a deal
          // card without ballooning the payload size.
          participants: {
            select: { id: true, name: true, email: true, role: true, title: true },
            take: 8,
            // Role-rank fans out at the API consumer below (Prisma can't
            // express "decision_maker first, then everyone else"
            // declaratively without raw SQL). Just stable-order by
            // createdAt so the front-end's role-priority sort is
            // deterministic.
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      // Most recent past (non-chat) timeline entry per deal. Drives
      // the "Last activity" line on each card.
      prisma.dealTimelineEntry.groupBy({
        by: ["dealId"],
        where: {
          deal: { userId: user.id },
          entryDate: { lte: new Date() },
          type: { not: "chat" },
        },
        _max: { entryDate: true },
      }),
      // Earliest upcoming meeting per deal. Drives "Next meeting".
      prisma.dealTimelineEntry.groupBy({
        by: ["dealId"],
        where: {
          deal: { userId: user.id },
          entryDate: { gt: new Date() },
          type: "meeting",
        },
        _min: { entryDate: true },
      }),
      // Count of substantive timeline entries added since each deal's
      // last analysis. Drives the "N new entries since last analysis"
      // affordance on the right-rail Analysis Status block. Excludes
      // chat breadcrumbs (they're not new deal context) and deals
      // that have never been analyzed (the widget shows "Never
      // analyzed" for those instead). Using $queryRaw because the
      // per-deal "newer than this deal's own lastAnalyzedAt" filter
      // can't be expressed in a Prisma groupBy without a per-row
      // self-join.
      prisma.$queryRaw<Array<{ deal_id: string; cnt: bigint }>>`
        SELECT t."dealId" as deal_id, COUNT(*)::bigint as cnt
        FROM deal_timeline_entries t
        JOIN deals d ON d.id = t."dealId"
        WHERE d."userId" = ${user.id}
          AND d."lastAnalyzedAt" IS NOT NULL
          AND t."createdAt" > d."lastAnalyzedAt"
          AND t.type != 'chat'
        GROUP BY t."dealId"
      `,
    ]);

    const lastById = new Map(lastActivity.map((r) => [r.dealId, r._max.entryDate]));
    const nextById = new Map(nextMeeting.map((r) => [r.dealId, r._min.entryDate]));
    const newSinceById = new Map(newSinceAnalysis.map((r) => [r.deal_id, Number(r.cnt)]));

    const enriched = deals.map((d) => ({
      ...d,
      lastActivityAt: lastById.get(d.id) || null,
      nextMeetingAt: nextById.get(d.id) || null,
      newEntriesSinceAnalysis: newSinceById.get(d.id) || 0,
    }));

    return NextResponse.json({ deals: enriched });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}

// POST — create a new deal
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { name, companyName, companyUrl, stage, status, notes, projectId } = body;

    if (!name?.trim() || !companyName?.trim()) {
      return NextResponse.json({ error: "name and companyName are required" }, { status: 400 });
    }

    const deal = await prisma.deal.create({
      data: {
        userId: user.id,
        name: name.trim(),
        companyName: companyName.trim(),
        companyUrl: companyUrl?.trim() || null,
        stage: stage || "prospecting",
        status: status || "active",
        notes: notes?.trim() || null,
        projectId: projectId || null,
      },
    });

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error creating deal:", error);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
