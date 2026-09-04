import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { countUniqueMeetings } from "@/lib/deals/closed-stats";
import { ACTIVITY_ENTRY_TYPES } from "@/lib/deals/constants";

// GET — list user's deals (newest first)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const [deals, lastActivity, nextMeeting, newSinceAnalysis, recordedCalls, latestStageChange] = await Promise.all([
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
          // Open tasks — drives the "⚡ N tasks · 1 overdue" chip on
          // each card. Soonest-due first, capped small.
          tasks: {
            where: { status: { in: ["scheduled", "pinged"] } },
            select: { id: true, title: true, dueAt: true, status: true, executeVia: true, draftMessage: true, rationale: true },
            orderBy: { dueAt: "asc" },
            take: 5,
          },
        },
      }),
      // Most recent past COMMUNICATION entry per deal (meetings,
      // calls, Slack, email — not notes or bookkeeping). Drives the
      // "Last activity" line on each card.
      prisma.dealTimelineEntry.groupBy({
        by: ["dealId"],
        where: {
          deal: { userId: user.id },
          entryDate: { lte: new Date() },
          type: { in: ACTIVITY_ENTRY_TYPES },
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
      // Recorded-call entries (call_summary + call_transcript) per
      // deal, fetched in full so we can dedupe per-deal — a single
      // meeting often produces both a summary AND a transcript entry
      // and the user wants ONE count per unique meeting. See
      // countUniqueMeetings in lib/deals/closed-stats. Bounded by
      // total call entries across all of the user's deals — well
      // under hundreds even for active founders.
      prisma.dealTimelineEntry.findMany({
        where: {
          deal: { userId: user.id },
          type: { in: ["call_summary", "call_transcript"] },
        },
        select: { id: true, dealId: true, type: true, title: true, entryDate: true, metadata: true },
      }),
      // Most recent stage_change entry per deal → "stage entered at".
      // Drives the "Days in stage" stat on the open-deal summary
      // block. Deals that never moved stages get null here and the
      // client falls back to createdAt.
      prisma.dealTimelineEntry.groupBy({
        by: ["dealId"],
        where: {
          deal: { userId: user.id },
          type: "stage_change",
        },
        _max: { entryDate: true },
      }),
    ]);

    const lastById = new Map(lastActivity.map((r) => [r.dealId, r._max.entryDate]));
    const nextById = new Map(nextMeeting.map((r) => [r.dealId, r._min.entryDate]));
    const newSinceById = new Map(newSinceAnalysis.map((r) => [r.deal_id, Number(r.cnt)]));
    // Bucket the recorded-call entries by dealId, then run the
    // shared dedupe helper so summary + transcript pairs for the
    // same meeting only count once.
    const callEntriesByDeal = new Map<string, typeof recordedCalls>();
    for (const e of recordedCalls) {
      const bucket = callEntriesByDeal.get(e.dealId) ?? [];
      bucket.push(e);
      callEntriesByDeal.set(e.dealId, bucket);
    }
    const recordedCallsById = new Map<string, number>();
    for (const [dealId, bucket] of callEntriesByDeal) {
      recordedCallsById.set(
        dealId,
        countUniqueMeetings(
          bucket.map((e) => ({
            id: e.id,
            type: e.type,
            title: e.title,
            entryDate: e.entryDate,
            metadata: e.metadata,
          }))
        )
      );
    }
    const stageEnteredById = new Map(latestStageChange.map((r) => [r.dealId, r._max.entryDate]));

    const enriched = deals.map((d) => ({
      ...d,
      lastActivityAt: lastById.get(d.id) || null,
      nextMeetingAt: nextById.get(d.id) || null,
      newEntriesSinceAnalysis: newSinceById.get(d.id) || 0,
      recordedCallCount: recordedCallsById.get(d.id) || 0,
      stageEnteredAt: stageEnteredById.get(d.id) || null,
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
