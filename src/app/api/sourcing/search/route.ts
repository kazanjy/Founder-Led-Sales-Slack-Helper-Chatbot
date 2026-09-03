import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchPeople } from "@/lib/search/apollo";

export const maxDuration = 60;

/**
 * Search Apollo for candidate leads.
 *
 * Two modes, and the difference matters more than it looks:
 *
 *   alumni  — person_past_organization_ids. People who USED to work at
 *             the named companies. This is the useful one for a
 *             founder's "where to look" tiers, because those tiers name
 *             small specialist orgs: Apollo indexes exactly one current
 *             AE at RevenueCat, so everyone who left is the real pool.
 *   current — organization_ids. People there now.
 *
 * Results are leads, not candidates. Apollo's search response carries no
 * dates and no work history, so nothing here can be assessed until it
 * has been enriched.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const orgIds: string[] = Array.isArray(body.orgIds) ? body.orgIds.filter(Boolean) : [];
    const titles: string[] = Array.isArray(body.titles) ? body.titles.filter(Boolean) : [];
    const mode = body.mode === "current" ? "current" : "alumni";

    if (orgIds.length === 0) {
      return NextResponse.json({ error: "Pick at least one company." }, { status: 400 });
    }
    if (titles.length === 0) {
      return NextResponse.json({ error: "Give at least one job title." }, { status: 400 });
    }

    const { leads, total, error } = await searchPeople({
      titles,
      ...(mode === "alumni" ? { pastOrganizationIds: orgIds } : { organizationIds: orgIds }),
      personLocations: Array.isArray(body.locations) ? body.locations.filter(Boolean) : undefined,
      employeeCountRanges: Array.isArray(body.employeeCountRanges)
        ? body.employeeCountRanges.filter(Boolean)
        : undefined,
      totalYearsExperience:
        typeof body.yoeMin === "number" || typeof body.yoeMax === "number"
          ? { min: body.yoeMin ?? undefined, max: body.yoeMax ?? undefined }
          : undefined,
      // Apollo widens loose titles by default, which drags Enterprise AEs
      // into a commercial/mid-market search.
      includeSimilarTitles: body.includeSimilarTitles === true,
      page: typeof body.page === "number" ? body.page : 1,
      perPage: typeof body.perPage === "number" ? body.perPage : 25,
    });

    if (error) return NextResponse.json({ error }, { status: 502 });
    return NextResponse.json({ leads, total, mode });
  } catch (error) {
    console.error("[sourcing/search]", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
