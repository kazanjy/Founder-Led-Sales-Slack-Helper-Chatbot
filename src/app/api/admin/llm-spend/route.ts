import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/admin";

/**
 * GET /api/admin/llm-spend?days=7
 *
 * Spend by feature, newest window first. Aggregated in SQL rather than
 * pulled into memory: a week of metering is tens of thousands of rows
 * and the answer is a few dozen.
 *
 * Both a cost and a call count are returned because they rank
 * differently and the gap is the interesting part — a cheap call made
 * ten thousand times and one expensive call made twice can cost the
 * same, and they need opposite fixes.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [byLabel, byModel, totals] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        label: string;
        calls: bigint;
        cost: number;
        prompt_tokens: bigint;
        completion_tokens: bigint;
        cached_tokens: bigint;
        failures: bigint;
        p50_ms: number;
        max_ms: number;
      }>
    >`
      SELECT "label",
             COUNT(*)                                        AS calls,
             COALESCE(SUM("costUsd"), 0)                     AS cost,
             COALESCE(SUM("promptTokens"), 0)                AS prompt_tokens,
             COALESCE(SUM("completionTokens"), 0)            AS completion_tokens,
             COALESCE(SUM("cachedTokens"), 0)                AS cached_tokens,
             COUNT(*) FILTER (WHERE NOT "ok")                AS failures,
             COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "durationMs"), 0) AS p50_ms,
             COALESCE(MAX("durationMs"), 0)                  AS max_ms
      FROM "llm_calls"
      WHERE "createdAt" >= ${since}
      GROUP BY "label"
      ORDER BY cost DESC
      LIMIT 100
    `,
    prisma.$queryRaw<Array<{ model: string; calls: bigint; cost: number }>>`
      SELECT "model", COUNT(*) AS calls, COALESCE(SUM("costUsd"), 0) AS cost
      FROM "llm_calls"
      WHERE "createdAt" >= ${since}
      GROUP BY "model"
      ORDER BY cost DESC
    `,
    prisma.$queryRaw<Array<{ calls: bigint; cost: number; failures: bigint }>>`
      SELECT COUNT(*) AS calls,
             COALESCE(SUM("costUsd"), 0) AS cost,
             COUNT(*) FILTER (WHERE NOT "ok") AS failures
      FROM "llm_calls"
      WHERE "createdAt" >= ${since}
    `,
  ]);

  // BigInt doesn't survive JSON.stringify.
  const n = (v: bigint | number) => Number(v);

  return NextResponse.json({
    days,
    total: totals[0]
      ? { calls: n(totals[0].calls), cost: totals[0].cost, failures: n(totals[0].failures) }
      : { calls: 0, cost: 0, failures: 0 },
    byModel: byModel.map((r) => ({ model: r.model, calls: n(r.calls), cost: r.cost })),
    byLabel: byLabel.map((r) => ({
      label: r.label,
      calls: n(r.calls),
      cost: r.cost,
      costPerCall: n(r.calls) > 0 ? r.cost / n(r.calls) : 0,
      promptTokens: n(r.prompt_tokens),
      completionTokens: n(r.completion_tokens),
      cachedTokens: n(r.cached_tokens),
      // What share of input was served from cache. Low numbers on a
      // repeat-heavy caller are a cost lever.
      cacheHitPct:
        n(r.prompt_tokens) > 0 ? (100 * n(r.cached_tokens)) / n(r.prompt_tokens) : 0,
      failures: n(r.failures),
      p50Ms: Math.round(r.p50_ms),
      maxMs: n(r.max_ms),
    })),
  });
}
