import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  runSourcingSearch,
  persistLeads,
  deriveSearchName,
  searchScope,
  type SourcingCompany,
  type SourcingCriteria,
} from "@/lib/sourcing/searches";

export const maxDuration = 120;

/** GET — the saved searches, newest first, with lead counts. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const searches = await prisma.sourcingSearch.findMany({
      where: searchScope(user),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        _count: { select: { leads: true } },
        // Cheap counts for the list: how much of this search has been
        // enriched, and how much shortlisted.
        leads: {
          select: { enrichedAt: true, status: true },
        },
      },
    });

    return NextResponse.json({
      searches: searches.map((s) => ({
        id: s.id,
        name: s.name || deriveSearchName({
          roleType: s.roleType,
          companies: (s.companies as unknown as SourcingCompany[]) || [],
          titles: [],
          locations: [],
          modes: (s.modes as unknown as string[]) || [],
        }),
        roleType: s.roleType,
        totalFound: s.totalFound,
        leadCount: s._count.leads,
        enrichedCount: s.leads.filter((l) => l.enrichedAt).length,
        shortlistedCount: s.leads.filter((l) => l.status === "shortlisted").length,
        lastRunAt: s.lastRunAt,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error("[sourcing/searches] GET", error);
    return NextResponse.json({ error: "Failed to load searches" }, { status: 500 });
  }
}

/** POST — run a new search and save it. Returns the id to navigate to. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const companies: SourcingCompany[] = Array.isArray(body.companies)
      ? body.companies.filter((c: SourcingCompany) => c?.apolloOrgId)
      : [];
    const titles: string[] = Array.isArray(body.titles) ? body.titles.filter(Boolean) : [];
    const modes = (["alumni", "current"] as const).filter((m) =>
      (Array.isArray(body.modes) ? body.modes : ["alumni"]).includes(m)
    );

    if (companies.length === 0) {
      return NextResponse.json({ error: "Resolve at least one company first." }, { status: 400 });
    }
    if (titles.length === 0) {
      return NextResponse.json({ error: "Give at least one job title." }, { status: 400 });
    }
    if (modes.length === 0) {
      return NextResponse.json(
        { error: "Choose people who worked there previously, currently, or both." },
        { status: 400 }
      );
    }

    const criteria: SourcingCriteria = {
      roleType: typeof body.roleType === "string" ? body.roleType : "AE",
      companies,
      titles,
      locations: Array.isArray(body.locations) ? body.locations.filter(Boolean) : [],
      modes: [...modes],
      yoeMin: typeof body.yoeMin === "number" ? body.yoeMin : null,
      yoeMax: typeof body.yoeMax === "number" ? body.yoeMax : null,
    };

    const run = await runSourcingSearch(criteria);
    // Only fail outright if every leg failed. One provider hiccup
    // shouldn't discard results that did come back.
    if (run.leads.length === 0 && run.errors.length > 0) {
      return NextResponse.json({ error: run.errors.join("; ") }, { status: 502 });
    }

    const search = await prisma.sourcingSearch.create({
      data: {
        userId: user.id,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
        roleType: criteria.roleType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        companies: criteria.companies as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        titles: criteria.titles as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        locations: criteria.locations as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        modes: criteria.modes as any,
        yoeMin: criteria.yoeMin,
        yoeMax: criteria.yoeMax,
        totalFound: run.total,
      },
    });

    await persistLeads(search.id, user.id, run.leads);

    return NextResponse.json({
      id: search.id,
      saved: run.leads.length,
      total: run.total,
      partialError: run.errors.length > 0 ? run.errors.join("; ") : undefined,
    });
  } catch (error) {
    console.error("[sourcing/searches] POST", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
