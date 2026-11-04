import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

/**
 * POST /api/deals/bulk-analyze
 *
 * Streams progress while running runDealAnalysis() sequentially over the
 * given dealIds. SSE events:
 *   - event: started   data: { total }
 *   - event: progress  data: { dealId, dealName, index, total,
 *                              status: "analyzing"|"done"|"failed",
 *                              mikeyHealth?, healthFlipped?, error? }
 *   - event: complete  data: { analyzed, failed, healthFlips }
 *
 * Sequential because runDealAnalysis hits the same OpenAI account and
 * runs a Prisma transaction per deal — parallel would risk both
 * rate-limit errors and serialization failures. Same pattern as the
 * daily cron at /api/cron/refresh-deal-health.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_DEALS_PER_REQUEST = 50;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body.dealIds) ? body.dealIds : [];
  const dealIds = rawIds.filter((d): d is string => typeof d === "string");
  if (dealIds.length === 0) {
    return new Response(JSON.stringify({ error: "No dealIds provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (dealIds.length > MAX_DEALS_PER_REQUEST) {
    return new Response(
      JSON.stringify({ error: `Too many deals (max ${MAX_DEALS_PER_REQUEST} per request)` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Resolve deals + filter to ones the user actually has access to.
  // Account-scoped if the user is on a team, otherwise strict userId.
  const accessibleDeals = await prisma.deal.findMany({
    where: user.accountId
      ? { id: { in: dealIds }, user: { accountId: user.accountId } }
      : { id: { in: dealIds }, userId: user.id },
    select: { id: true, userId: true, name: true, mikeyHealth: true },
  });
  // Preserve the order the client sent so the UI matches its rendered order.
  const idOrder = new Map(dealIds.map((id, i) => [id, i]));
  accessibleDeals.sort(
    (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0)
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send("started", { total: accessibleDeals.length });

        let analyzed = 0;
        let failed = 0;
        let healthFlips = 0;

        for (let i = 0; i < accessibleDeals.length; i++) {
          const deal = accessibleDeals[i];
          send("progress", {
            dealId: deal.id,
            dealName: deal.name,
            index: i,
            total: accessibleDeals.length,
            status: "analyzing",
          });
          try {
            const result = await runDealAnalysis(deal.userId, deal.id);
            analyzed++;
            const flipped =
              !!result.mikeyHealth && result.mikeyHealth !== deal.mikeyHealth;
            if (flipped) healthFlips++;
            send("progress", {
              dealId: deal.id,
              dealName: deal.name,
              index: i,
              total: accessibleDeals.length,
              status: "done",
              mikeyHealth: result.mikeyHealth,
              healthFlipped: flipped,
            });
          } catch (err) {
            if (err instanceof DealNotFoundError) {
              // Skip silently — likely a delete in flight.
              send("progress", {
                dealId: deal.id,
                dealName: deal.name,
                index: i,
                total: accessibleDeals.length,
                status: "failed",
                error: "Deal no longer exists",
              });
              continue;
            }
            console.error(`[bulk-analyze] ${deal.id} failed:`, err);
            failed++;
            send("progress", {
              dealId: deal.id,
              dealName: deal.name,
              index: i,
              total: accessibleDeals.length,
              status: "failed",
              error: err instanceof Error ? err.message : "Analysis failed",
            });
          }
        }

        send("complete", { analyzed, failed, healthFlips });
      } catch (err) {
        console.error("[bulk-analyze] fatal:", err);
        try {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                error: err instanceof Error ? err.message : "Bulk analyze failed",
              })}\n\n`
            )
          );
        } catch { /* already closed */ }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    },
  });
}
