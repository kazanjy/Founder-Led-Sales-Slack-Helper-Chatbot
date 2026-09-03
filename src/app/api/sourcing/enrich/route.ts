import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichPersonById, isEducationEntry } from "@/lib/search/apollo";
import { rubricFor } from "@/lib/hiring/flag-engine";

export const maxDuration = 120;

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
 * Enrich sourced leads into something triageable.
 *
 * A search result is a first name, a masked surname and a title — not
 * enough to judge anyone. This turns a batch of Apollo ids into real
 * work history and a per-EMPLOYER tenure read.
 *
 * Per employer, not per role, deliberately: that is the load-bearing
 * rule of the whole rubric. Two titles at one company is a promotion,
 * not two short jobs, and aggregating anywhere else manufactures job
 * hopping out of a career that never left the building.
 *
 * The numbers here use the same ROLE_RUBRICS thresholds as the full
 * assessment, so a lead that looks clean in triage does not turn into a
 * serial short-stint flag the moment it is properly assessed.
 *
 * This is a preview, NOT an assessment. It runs no flag detection and
 * writes nothing. The enriched linkedinUrl is the handoff to the real
 * assessment flow.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one lead." }, { status: 400 });
    }
    // Guard rail while this is a prototype: one accidental click should
    // not spend hundreds of credits.
    if (ids.length > 25) {
      return NextResponse.json(
        { error: "Enrich 25 at a time or fewer while this is a prototype." },
        { status: 400 }
      );
    }

    const rubric = rubricFor(typeof body.roleLabel === "string" ? body.roleLabel : "AE");
    const results = [];

    for (const id of ids) {
      const { data, error } = await enrichPersonById(id);
      if (!data) {
        results.push({ id, error: error || "No match" });
        continue;
      }

      const jobs = (data.employment_history || []).filter((e) => !isEducationEntry(e));

      // Aggregate to one row per employer: earliest start, latest end,
      // every title held there.
      const byCompany = new Map<
        string,
        { company: string; start: string | null; end: string | null; current: boolean; titles: string[] }
      >();
      for (const j of jobs) {
        const company = (j.organization_name || "Unknown").trim();
        const key = company.toLowerCase();
        const start = toYearMonth(j.start_date);
        const end = j.current ? null : toYearMonth(j.end_date);
        const existing = byCompany.get(key);
        if (!existing) {
          byCompany.set(key, {
            company,
            start,
            end,
            current: !!j.current,
            titles: j.title ? [j.title] : [],
          });
          continue;
        }
        if (start && (!existing.start || start < existing.start)) existing.start = start;
        if (existing.current || j.current) {
          existing.current = true;
          existing.end = null;
        } else if (end && (!existing.end || end > existing.end)) {
          existing.end = end;
        }
        if (j.title && !existing.titles.includes(j.title)) existing.titles.push(j.title);
      }

      const employers = [...byCompany.values()]
        .map((c) => ({ ...c, months: monthsBetween(c.start, c.end) }))
        .sort((a, b) => (b.start || "").localeCompare(a.start || ""));

      // A current role is not a short stint — the person is still in it.
      const shortStints = employers.filter(
        (c) => !c.current && c.months !== null && c.months < rubric.shortStintMonths
      ).length;

      results.push({
        id,
        name: data.name,
        linkedinUrl: data.linkedin_url,
        headline: data.headline || data.title,
        currentCompany: data.organization_name || data.organization?.name || null,
        employers,
        employerCount: employers.length,
        shortStints,
        shortStintMonths: rubric.shortStintMonths,
        // Mirrors the rubric's own language so triage and assessment agree.
        tenureVerdict:
          shortStints >= rubric.serialShortStintDisasterCount
            ? "disaster"
            : shortStints >= rubric.serialShortStintCount
              ? "pattern"
              : "clean",
      });
    }

    return NextResponse.json({ results, enriched: results.filter((r) => !("error" in r)).length });
  } catch (error) {
    console.error("[sourcing/enrich]", error);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}
