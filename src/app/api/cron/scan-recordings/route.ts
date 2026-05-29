import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scanUserRecordings } from "@/lib/deals/scan-recordings";

/**
 * GET /api/cron/scan-recordings
 *
 * Hourly Vercel cron. For each user with an active call recorder,
 * pulls their most recent calls, attaches matched ones to existing
 * deals (with a Slack DM heads-up), and spins up "Potential" deals
 * with Validate / Dismiss Slack buttons for unmatched ones.
 *
 * Bearer-token gated via CRON_SECRET so Vercel cron can hit it.
 */

export const maxDuration = 300;

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
  for (const c of conns) {
    try {
      summary.push(await scanUserRecordings(c.userId));
    } catch (err) {
      console.error(`[cron scan-recordings] User ${c.userId} threw:`, err);
      summary.push({ userId: c.userId, scanned: 0, attached: 0, potentials: 0, skipped: 0, errors: 1 });
    }
  }

  return NextResponse.json({ ok: true, users: conns.length, summary });
}
