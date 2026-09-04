import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  criteriaFromRow,
  deriveSearchName,
  persistLeads,
  runSourcingSearch,
  searchScope,
} from "@/lib/sourcing/searches";

export const maxDuration = 120;

async function loadOwned(id: string, user: { id: string; accountId: string | null }) {
  return prisma.sourcingSearch.findFirst({
    where: { id, ...searchScope(user) },
    include: { leads: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] } },
  });
}

/** GET — one saved search with its leads. This is what /sourcing/<id> renders. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id } = await params;
    const search = await loadOwned(id, user);
    if (!search) return NextResponse.json({ error: "Search not found" }, { status: 404 });

    const criteria = criteriaFromRow(search);
    return NextResponse.json({
      search: {
        id: search.id,
        name: search.name || deriveSearchName(criteria),
        customName: search.name,
        ...criteria,
        totalFound: search.totalFound,
        lastRunAt: search.lastRunAt,
        createdAt: search.createdAt,
      },
      leads: search.leads,
    });
  } catch (error) {
    console.error("[sourcing/searches/:id] GET", error);
    return NextResponse.json({ error: "Failed to load search" }, { status: 500 });
  }
}

/**
 * PATCH — rename, or re-run against Apollo.
 *
 * Re-running MERGES. Leads are unique on (searchId, apolloId), and the
 * upsert deliberately leaves the enrichment and status columns alone,
 * so a re-run never discards credits already spent or a decision
 * already made about someone.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.sourcingSearch.findFirst({
      where: { id, ...searchScope(user) },
    });
    if (!existing) return NextResponse.json({ error: "Search not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));

    if (typeof body.name === "string") {
      const updated = await prisma.sourcingSearch.update({
        where: { id },
        data: { name: body.name.trim() || null },
      });
      return NextResponse.json({ ok: true, name: updated.name });
    }

    if (body.rerun === true) {
      const criteria = criteriaFromRow(existing);
      const run = await runSourcingSearch(criteria);
      if (run.leads.length === 0 && run.errors.length > 0) {
        return NextResponse.json({ error: run.errors.join("; ") }, { status: 502 });
      }
      const before = await prisma.sourcingLead.count({ where: { searchId: id } });
      await persistLeads(id, existing.userId, run.leads);
      const after = await prisma.sourcingLead.count({ where: { searchId: id } });
      await prisma.sourcingSearch.update({
        where: { id },
        data: { totalFound: run.total, lastRunAt: new Date() },
      });
      return NextResponse.json({
        ok: true,
        newLeads: after - before,
        total: run.total,
        partialError: run.errors.length > 0 ? run.errors.join("; ") : undefined,
      });
    }

    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  } catch (error) {
    console.error("[sourcing/searches/:id] PATCH", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

/** DELETE — drops the search and, by cascade, its leads. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.sourcingSearch.findFirst({
      where: { id, ...searchScope(user) },
    });
    if (!existing) return NextResponse.json({ error: "Search not found" }, { status: 404 });

    await prisma.sourcingSearch.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[sourcing/searches/:id] DELETE", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
