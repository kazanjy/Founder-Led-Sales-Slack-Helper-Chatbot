import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { scanUserRecordings } from "@/lib/deals/scan-recordings";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

/**
 * GET /api/cron/scan-recordings
 *
 * Hourly Vercel cron. For each user with an active call recorder,
 * pulls their most recent calls, attaches matched ones to existing
 * deals (with a Slack DM heads-up), and spins up "Potential" deals
 * with Validate / Dismiss Slack buttons for unmatched ones.
 *
 * After all per-user scans finish, fires runDealAnalysis once per
 * existing deal that got a new call attached this tick (via
 * after() so the cron response returns promptly). A 12-hour skip
 * window prevents stomping on a manual Analyze the user just
 * triggered, mirroring the bound the old refresh-deal-health cron
 * used before it was retired.
 *
 * Bearer-token gated via CRON_SECRET so Vercel cron can hit it.
 */

export const maxDuration = 300;

const REANALYZE_SKIP_HOURS = 12;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const conns = await prisma.meetingRecorderConnection.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const summary = [];
  // Collect (userId, dealId) pairs that need a post-scan re-analysis.
  // De-duped by dealId since one deal only ever has one owning user.
  const reanalysisTargets: Array<{ userId: string; dealId: string }> = [];
  for (const c of conns) {
    try {
      const result = await scanUserRecordings(c.userId);
      summary.push(result);
      for (const dealId of result.attachedExistingDealIds) {
        reanalysisTargets.push({ userId: c.userId, dealId });
      }
    } catch (err) {
      console.error(`[cron scan-recordings] User ${c.userId} threw:`, err);
      summary.push({
        userId: c.userId,
        scanned: 0,
        attached: 0,
        potentials: 0,
        skipped: 0,
        errors: 1,
        attachedExistingDealIds: [] as string[],
      });
    }
  }

  // Fire analyses sequentially in the background after the cron's HTTP
  // response goes out. Sequential keeps OpenAI / Prisma load bounded;
  // the per-call analyzer is the same one the per-card "Update" CTA
  // uses, so this is the same cost shape just batched.
  if (reanalysisTargets.length > 0) {
    after(async () => {
      const cutoff = new Date(Date.now() - REANALYZE_SKIP_HOURS * 60 * 60 * 1000);
      for (const { userId, dealId } of reanalysisTargets) {
        try {
          // Skip if the user re-analyzed within the cooldown window —
          // they just paid for a fresh analysis manually and we don't
          // want to clobber it.
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
          console.error(`[cron scan-recordings] post-scan analyze ${dealId} failed:`, err);
        }
      }
    });
  }

  return NextResponse.json({
    ok: true,
    users: conns.length,
    summary,
    queuedReanalyses: reanalysisTargets.length,
  });
}
