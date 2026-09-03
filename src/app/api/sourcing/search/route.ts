import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchPeople } from "@/lib/search/apollo";

export const maxDuration = 60;

/**
 * Search Apollo for candidate leads.
 *
 * Two relationships to a company, and the difference matters more than
 * it looks:
 *
 *   alumni  — person_past_organization_ids. People who USED to work at
 *             the named companies. This is the useful one for a
 *             founder's "where to look" tiers, because those tiers name
 *             small specialist orgs: Apollo indexes exactly one current
 *             AE at RevenueCat, so everyone who left is the real pool.
 *   current — organization_ids. People there now.
 *
 * BOTH IS ONE QUERY PER MODE, MERGED HERE — deliberately, not for want
 * of trying the obvious thing. Apollo takes these as two separate
 * parameters and it is not established whether it ANDs or ORs them when
 * both are present. If it ANDs, a combined request means "currently AND
 * previously at the same company", which is almost nobody, and the
 * failure is silent: a valid-looking empty result. Running them
 * separately and unioning on Apollo's person id is correct either way,
 * costs one extra search credit, and yields something a single query
 * could not — which relationship found each person, so outreach can be
 * pitched differently to someone still in the seat.
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

    // `modes` is the current shape; `mode` is still accepted so an older
    // client doesn't break.
    const requested: string[] = Array.isArray(body.modes)
      ? body.modes
      : body.mode
        ? [body.mode]
        : ["alumni"];
    const modes = (["alumni", "current"] as const).filter((m) => requested.includes(m));

    if (orgIds.length === 0) {
      return NextResponse.json({ error: "Pick at least one company." }, { status: 400 });
    }
    if (titles.length === 0) {
      return NextResponse.json({ error: "Give at least one job title." }, { status: 400 });
    }
    if (modes.length === 0) {
      return NextResponse.json(
        { error: "Choose whether you want people who worked there previously, currently, or both." },
        { status: 400 }
      );
    }

    const shared = {
      titles,
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
    };

    const merged = new Map<string, Record<string, unknown> & { via: string[] }>();
    const totals: Record<string, number> = {};
    const errors: string[] = [];

    for (const mode of modes) {
      const { leads, total, error } = await searchPeople({
        ...shared,
        ...(mode === "alumni" ? { pastOrganizationIds: orgIds } : { organizationIds: orgIds }),
      });
      if (error) {
        errors.push(`${mode}: ${error}`);
        continue;
      }
      totals[mode] = total;
      for (const lead of leads) {
        const existing = merged.get(lead.id);
        if (existing) {
          // Someone can legitimately surface in both: a rep who left and
          // later returned. Keep both tags rather than letting whichever
          // query ran last decide.
          if (!existing.via.includes(mode)) existing.via.push(mode);
        } else {
          merged.set(lead.id, { ...lead, via: [mode] });
        }
      }
    }

    // Only fail if BOTH legs failed. One provider hiccup shouldn't throw
    // away results that did come back.
    if (merged.size === 0 && errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
    }

    return NextResponse.json({
      leads: [...merged.values()],
      // Sum of the per-mode totals, so the "of N" figure isn't wrong
      // when both are on. Slightly over-counts anyone in both, which is
      // rare and preferable to reporting one mode's total as the whole.
      total: Object.values(totals).reduce((a, b) => a + b, 0),
      totals,
      modes,
      partialError: errors.length > 0 ? errors.join("; ") : undefined,
    });
  } catch (error) {
    console.error("[sourcing/search]", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
