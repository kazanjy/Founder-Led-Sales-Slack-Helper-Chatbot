import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { scanFutureMeetingsForUser } from "@/lib/deals/scan-future-meetings";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

/**
 * GET /api/cron/scan-future-meetings
 *
 * Every-5-minutes Vercel cron. For each calendar-connected user, runs
 * the forward calendar sweep (next 90 days, one calendar fetch
 * bucketed across every in-play deal — see
 * lib/deals/scan-future-meetings.ts) so new meetings land on deal
 * timelines within minutes of hitting the calendar, without anyone
 * clicking "Scan Calendar".
 *
 * Deals that gained meetings get a re-analysis cascade (Mikey Health
 * + upcoming-meeting prep guidance reflect the new calendar evidence)
 * — fired via after() so the cron response returns promptly, run
 * sequentially to bound OpenAI/Prisma load, and skipped when the deal
 * was analyzed within the cooldown window (don't clobber an analysis
 * the user just paid for). Mirrors the scan-recordings cron's shape.
 *
 * The sweep itself is LLM-free (calendar API + DB only) and dedupes
 * by calendarEventId, so the common no-new-meetings tick is cheap and
 * idempotent.
 *
 * Bearer-token gated via CRON_SECRET so Vercel cron can hit it.
 */

export const maxDuration = 300;

const REANALYZE_SKIP_HOURS = 12;
// Safety valve: a single tick will cascade at most this many
// analyses. A giant backlog (first run after a long outage) trickles
// out over subsequent ticks instead of burning one huge OpenAI batch.
const MAX_REANALYSES_PER_TICK = 10;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Everyone with a Google connection — calendar scope is verified
  // inside the sweep (returns hasCalendar:false gracefully when the
  // token lacks it).
  const users = await prisma.user.findMany({
    where: { googleRefreshToken: { not: null } },
    select: { id: true },
  });

  const summary: Array<{
    userId: string;
    dealsScanned: number;
    added: number;
    errors: number;
  }> = [];
  const reanalysisTargets: Array<{ userId: string; dealId: string }> = [];

  for (const u of users) {
    try {
      const result = await scanFutureMeetingsForUser(u.id);
      summary.push({
        userId: u.id,
        dealsScanned: result.dealsScanned,
        added: result.totalEventsAdded,
        errors: 0,
      });
      for (const d of result.perDeal) {
        if (d.added > 0) reanalysisTargets.push({ userId: u.id, dealId: d.dealId });
      }
    } catch (err) {
      console.error(`[cron scan-future-meetings] user ${u.id} threw:`, err);
      summary.push({ userId: u.id, dealsScanned: 0, added: 0, errors: 1 });
    }
  }

  const capped = reanalysisTargets.slice(0, MAX_REANALYSES_PER_TICK);
  if (reanalysisTargets.length > capped.length) {
    console.log(
      `[cron scan-future-meetings] capping reanalyses ${reanalysisTargets.length} → ${capped.length}; the rest re-qualify on later ticks`
    );
  }

  if (capped.length > 0) {
    after(async () => {
      const cutoff = new Date(Date.now() - REANALYZE_SKIP_HOURS * 60 * 60 * 1000);
      for (const { userId, dealId } of capped) {
        try {
          const recent = await prisma.deal.findUnique({
            where: { id: dealId },
            select: { lastAnalyzedAt: true },
          });
          if (recent?.lastAnalyzedAt && recent.lastAnalyzedAt > cutoff) {
            continue;
          }
          await runDealAnalysis(userId, dealId);
        } catch (err) {
          if (err instanceof DealNotFoundError) continue;
          console.error(`[cron scan-future-meetings] post-scan analyze ${dealId} failed:`, err);
        }
      }
    });
  }

  const totalAdded = summary.reduce((n, s) => n + s.added, 0);
  if (totalAdded > 0) {
    console.log(
      `[cron scan-future-meetings] added ${totalAdded} meeting(s) across ${users.length} user(s); queued ${capped.length} reanalyses`
    );
  }

  return NextResponse.json({
    ok: true,
    users: users.length,
    totalAdded,
    queuedReanalyses: capped.length,
    summary: summary.filter((s) => s.added > 0 || s.errors > 0),
  });
}
