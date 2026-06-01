import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enrichDeal } from "@/lib/deals/enrich";

// Bumped so after() can hold enrichment work for any validate flips.
export const maxDuration = 300;

const VALID_STATUSES = new Set([
  "active",
  "stalled",
  "closed_won",
  "closed_lost",
  "potential",
  "dismissed",
]);

// Bulk status update for the /deals "select multiple → Dismiss/Validate"
// flow. Owner-only; silently skips any id the user doesn't own.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealIds, status } = (await request.json()) as {
    dealIds?: unknown;
    status?: unknown;
  };

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return NextResponse.json({ error: "dealIds required" }, { status: 400 });
  }
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const ids = dealIds.filter((x): x is string => typeof x === "string");

  const owned = await prisma.deal.findMany({
    where: { id: { in: ids }, userId: user.id },
    select: { id: true, status: true },
  });
  if (owned.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const becameClosed = status === "closed_won" || status === "closed_lost";

  // Same auto-stamp logic as the single PATCH route: stamp closeDate
  // when transitioning into a closed state, clear when transitioning
  // back out. Per-row because the wasClosed check depends on the
  // existing row's status.
  await prisma.$transaction(
    owned.map((d) => {
      const wasClosed = d.status === "closed_won" || d.status === "closed_lost";
      const data: Record<string, unknown> = { status };
      if (becameClosed && !wasClosed) data.closeDate = new Date();
      if (!becameClosed && wasClosed) data.closeDate = null;
      return prisma.deal.update({ where: { id: d.id }, data });
    })
  );

  // Fire post-validate enrichment for any Potential → active flips.
  // Scheduled via after() so the response returns immediately.
  const validated = owned.filter((d) => d.status === "potential" && status === "active");
  if (validated.length > 0) {
    after(async () => {
      for (const d of validated) {
        try {
          const summary = await enrichDeal(user.id, d.id);
          console.log(`[bulk-status] enriched ${d.id}:`, summary);
        } catch (err) {
          console.error(`[bulk-status] enrich failed for ${d.id}:`, err);
        }
      }
    });
  }

  return NextResponse.json({ updated: owned.length });
}
