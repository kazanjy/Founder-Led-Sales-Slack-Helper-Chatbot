/**
 * Apollo vs PDL, head to head, on real LinkedIn URLs.
 *
 * The hiring path now enriches through Apollo because it is far cheaper
 * per match. The known risk is coverage: Apollo's education data is
 * thinner than PDL's, and school selectivity is one of the heaviest
 * green flags in the rubric. Coarser employment dates would also matter,
 * because the engine downgrades a flag to "possible" on year-only dates
 * and job hopping is the signal we most want stated loudly.
 *
 * Rather than argue about that, measure it. Run:
 *
 *   npx tsx scripts/compare-enrichment.ts <linkedin-url> [more urls...]
 *
 * Needs APOLLO_API_KEY and PDL_API_KEY. Costs one match per provider per
 * URL, so point it at a handful of profiles you already know well.
 */

import { enrichPersonByLinkedIn as apolloEnrich, isEducationEntry } from "../src/lib/search/apollo";
import { enrichPersonByLinkedIn as pdlEnrich } from "../src/lib/search/pdl";

const YEAR_ONLY = /^\d{4}$/;

interface Row {
  provider: string;
  matched: boolean;
  name: string | null;
  jobs: number;
  dated: number;
  yearOnly: number;
  schools: string[];
  majors: number;
  error?: string;
}

async function viaApollo(url: string): Promise<Row> {
  const { data, error } = await apolloEnrich(url);
  if (!data) return blank("apollo", error);
  const history = data.employment_history || [];
  const jobs = history.filter((e) => !isEducationEntry(e));
  const edu = history.filter(isEducationEntry);
  return {
    provider: "apollo",
    matched: true,
    name: data.name,
    jobs: jobs.length,
    dated: jobs.filter((e) => e.start_date).length,
    yearOnly: jobs.filter(
      (e) => YEAR_ONLY.test(e.start_date || "") || YEAR_ONLY.test(e.end_date || "")
    ).length,
    schools: [
      ...edu.map((e) => e.organization_name),
      ...(data.education || []).map((e) => e.school_name),
    ].filter((s): s is string => !!s),
    majors: [
      ...edu.map((e) => e.major),
      ...(data.education || []).map((e) => e.major),
    ].filter(Boolean).length,
  };
}

async function viaPdl(url: string): Promise<Row> {
  const { data, error } = await pdlEnrich(url);
  if (!data) return blank("pdl", error);
  const exp = data.experience || [];
  return {
    provider: "pdl",
    matched: true,
    name: data.full_name,
    jobs: exp.length,
    dated: exp.filter((e) => e.start_date).length,
    yearOnly: exp.filter(
      (e) => YEAR_ONLY.test(e.start_date || "") || YEAR_ONLY.test(e.end_date || "")
    ).length,
    schools: (data.education || []).map((e) => e.school?.name).filter((s): s is string => !!s),
    majors: (data.education || []).flatMap((e) => e.majors || []).length,
  };
}

function blank(provider: string, error?: string): Row {
  return {
    provider,
    matched: false,
    name: null,
    jobs: 0,
    dated: 0,
    yearOnly: 0,
    schools: [],
    majors: 0,
    error,
  };
}

function line(r: Row): string {
  if (!r.matched) return `  ${r.provider.padEnd(7)} NO MATCH — ${r.error || "unknown"}`;
  return (
    `  ${r.provider.padEnd(7)} ${(r.name || "?").padEnd(24)} ` +
    `jobs=${String(r.jobs).padStart(2)} dated=${String(r.dated).padStart(2)} ` +
    `year-only=${String(r.yearOnly).padStart(2)} ` +
    `schools=${String(r.schools.length).padStart(2)} majors=${String(r.majors).padStart(2)}` +
    (r.schools.length ? `\n          schools: ${r.schools.join(", ")}` : "")
  );
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/compare-enrichment.ts <linkedin-url> [...]");
    process.exit(1);
  }

  const totals = { apolloEdu: 0, pdlEdu: 0, apolloMiss: 0, pdlMiss: 0, n: urls.length };

  for (const url of urls) {
    console.log(`\n${url}`);
    // Sequential on purpose — these are paid calls and a burst against
    // either provider risks a 429 that reads as a coverage gap.
    const a = await viaApollo(url);
    const p = await viaPdl(url);
    console.log(line(a));
    console.log(line(p));
    if (a.schools.length) totals.apolloEdu++;
    if (p.schools.length) totals.pdlEdu++;
    if (!a.matched) totals.apolloMiss++;
    if (!p.matched) totals.pdlMiss++;
  }

  console.log(`\n── Summary over ${totals.n} profiles ──`);
  console.log(`  match rate      apollo ${totals.n - totals.apolloMiss}/${totals.n}   pdl ${totals.n - totals.pdlMiss}/${totals.n}`);
  console.log(`  education found apollo ${totals.apolloEdu}/${totals.n}   pdl ${totals.pdlEdu}/${totals.n}`);
  console.log(
    "\nRead: a large education gap means the school-selectivity and smart-major\n" +
      "green flags go quiet on URL-only assessments. A large year-only gap means\n" +
      "job-hopping flags soften to 'possible'. Either is a reason to keep PDL as\n" +
      "a fallback for shortlisted candidates."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
