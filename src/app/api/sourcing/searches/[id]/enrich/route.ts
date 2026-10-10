import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enrichPersonById, isEducationEntry } from "@/lib/search/apollo";
import { rubricFor } from "@/lib/hiring/flag-engine";
import { searchScope } from "@/lib/sourcing/searches";

export const maxDuration = 300;

/** Apollo dates are YYYY-MM-DD; the rubric works in months. */
function toYearMonth(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function monthsBetween(start: string | null, end: string | null): number | null {
  if (!start) return null;
  const [sy, sm] = start.split("-").map(Number);
  const e = end ?? new Date().toISOString().slice(0, 7);
  const [ey, em] = e.split("-").map(Number);
  if (!sy || !sm || !ey || !em) return null;
  return Math.max(0, (ey - sy) * 12 + (em - sm));
}

/**
 * Enrich selected leads and store the result on them.
 *
 * Storing is the point: enrichment costs a credit per person, and a
 * lead that has already been paid for should never be paid for twice.
 * Anything already enriched is skipped rather than re-fetched, so
 * clicking enrich on a whole list a second time is free.
 *
 * Tenure is aggregated per EMPLOYER, not per role — the load-bearing
 * rule of the whole rubric. Two titles at one company is a promotion,
 * not two short jobs, and aggregating any other way manufactures job
 * hopping out of a career that never left the building. The thresholds
 * come from ROLE_RUBRICS so this preview cannot disagree with the full
 * assessment that follows it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id } = await params;
    const search = await prisma.sourcingSearch.findFirst({
      where: { id, ...searchScope(user) },
    });
    if (!search) return NextResponse.json({ error: "Search not found" }, { status: 404 });

    const body = await request.json();
    const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.filter(Boolean) : [];
    if (leadIds.length === 0) {
      return NextResponse.json({ error: "Select at least one lead." }, { status: 400 });
    }
    if (leadIds.length > 25) {
      return NextResponse.json({ error: "Enrich 25 at a time or fewer." }, { status: 400 });
    }

    const leads = await prisma.sourcingLead.findMany({
      where: { id: { in: leadIds }, searchId: id },
    });

    const rubric = rubricFor(search.roleType);
    const updated = [];
    let skipped = 0;

    for (const lead of leads) {
      // Already bought — don't spend the credit again.
      if (lead.enrichedAt) {
        skipped++;
        updated.push(lead);
        continue;
      }

      const { data } = await enrichPersonById(lead.apolloId);
      if (!data) {
        // Record the attempt so a miss doesn't look like "not tried yet"
        // and invite another spend on a profile Apollo doesn't have.
        const row = await prisma.sourcingLead.update({
          where: { id: lead.id },
          data: { enrichedAt: new Date() },
        });
        updated.push(row);
        continue;
      }

      const jobs = (data.employment_history || []).filter((e) => !isEducationEntry(e));
      const byCompany = new Map<
        string,
        { company: string; start: string | null; end: string | null; current: boolean; titles: string[] }
      >();
      for (const j of jobs) {
        const company = (j.organization_name || "Unknown").trim();
        const key = company.toLowerCase();
        const start = toYearMonth(j.start_date);
        const end = j.current ? null : toYearMonth(j.end_date);
        const ex = byCompany.get(key);
        if (!ex) {
          byCompany.set(key, {
            company,
            start,
            end,
            current: !!j.current,
            titles: j.title ? [j.title] : [],
          });
          continue;
        }
        if (start && (!ex.start || start < ex.start)) ex.start = start;
        if (ex.current || j.current) {
          ex.current = true;
          ex.end = null;
        } else if (end && (!ex.end || end > ex.end)) {
          ex.end = end;
        }
        if (j.title && !ex.titles.includes(j.title)) ex.titles.push(j.title);
      }

      const employers = [...byCompany.values()]
        .map((c) => ({ ...c, months: monthsBetween(c.start, c.end) }))
        .sort((a, b) => (b.start || "").localeCompare(a.start || ""));

      // A current role is not a short stint — the person is still in it.
      const shortStints = employers.filter(
        (c) => !c.current && c.months !== null && c.months < rubric.shortStintMonths
      ).length;

      const row = await prisma.sourcingLead.update({
        where: { id: lead.id },
        data: {
          enrichedAt: new Date(),
          name: data.name,
          linkedinUrl: data.linkedin_url,
          headline: data.headline || data.title,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          employers: employers as any,
          shortStints,
          tenureVerdict:
            shortStints >= rubric.serialShortStintDisasterCount
              ? "disaster"
              : shortStints >= rubric.serialShortStintCount
                ? "pattern"
                : "clean",
        },
      });
      updated.push(row);
    }

    return NextResponse.json({
      leads: updated,
      enriched: updated.length - skipped,
      skipped,
      shortStintMonths: rubric.shortStintMonths,
    });
  } catch (error) {
    console.error("[sourcing/searches/:id/enrich]", error);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}
