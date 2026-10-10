import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

/**
 * GET /api/cron/refresh-deal-health
 *
 * Daily cron that re-runs the deal analyzer on every active /
 * stalled deal so Mikey Health, stage suggestions, and stakeholder
 * roles stay fresh without the user having to click "Analyze Deal".
 *
 * Cost control:
 *  - Only touches deals with status active/stalled (skips potential,
 *    dismissed, closed_won, closed_lost).
 *  - Skips any deal already analyzed within the last 12 hours so a
 *    manual click that morning doesn't get clobbered + double-billed.
 *  - Caps each user at MAX_PER_USER analyses per run so a teammate
 *    with 100 active deals doesn't burn the whole API budget.
 *  - Sequential per user (parallel across deals would risk Prisma
 *    transaction collisions and OpenAI rate limits).
 *
 * Bearer-token gated via CRON_SECRET.
 */

export const maxDuration = 600;

const MAX_PER_USER = 25;
const RECENT_THRESHOLD_HOURS = 12;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const recentCutoff = new Date(Date.now() - RECENT_THRESHOLD_HOURS * 60 * 60 * 1000);

  // Pull every deal eligible for refresh + group by user. Single
  // query so we can batch-budget per user before kicking off the
  // analyzer fan-out.
  const deals = await prisma.deal.findMany({
    where: {
      status: { in: ["active", "stalled"] },
      OR: [
        { lastAnalyzedAt: null },
        { lastAnalyzedAt: { lt: recentCutoff } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, userId: true, name: true },
  });

  const byUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const d of deals) {
    const bucket = byUser.get(d.userId) ?? [];
    if (bucket.length >= MAX_PER_USER) continue;
    bucket.push({ id: d.id, name: d.name });
    byUser.set(d.userId, bucket);
  }

  const summary: Array<{
    userId: string;
    analyzed: number;
    failed: number;
    healthFlips: number;
  }> = [];

  for (const [userId, userDeals] of byUser) {
    let analyzed = 0;
    let failed = 0;
    let healthFlips = 0;
    for (const d of userDeals) {
      try {
        // Snapshot prior health so we can count actual changes for
        // logging — useful when watching the cron in production.
        const before = await prisma.deal.findUnique({
          where: { id: d.id },
          select: { mikeyHealth: true },
        });
        const result = await runDealAnalysis(userId, d.id);
        analyzed++;
        if (result.mikeyHealth && result.mikeyHealth !== before?.mikeyHealth) {
          healthFlips++;
        }
      } catch (err) {
        if (err instanceof DealNotFoundError) continue;
        console.error(`[cron refresh-deal-health] ${userId}/${d.id} failed:`, err);
        failed++;
      }
    }
    summary.push({ userId, analyzed, failed, healthFlips });
  }

  return NextResponse.json({
    ok: true,
    eligibleDeals: deals.length,
    users: byUser.size,
    summary,
  });
}
