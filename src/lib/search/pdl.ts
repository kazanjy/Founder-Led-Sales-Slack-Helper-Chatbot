import type { ParsedSearchInput } from "./types";

const PDL_API_KEY = process.env.PDL_API_KEY;
const PDL_BASE_URL = "https://api.peopledatalabs.com/v5";

// ── Response types (only the fields we actually use) ─────────────

export interface PDLPersonResult {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  job_title_role: string | null;
  job_company_name: string | null;
  job_company_website: string | null;
  job_company_industry: string | null;
  job_company_size: string | null;
  job_company_founded: number | null;
  job_start_date: string | null;
  linkedin_url: string | null;
  summary: string | null;
  industry: string | null;
  location_name: string | null;
  experience: PDLExperience[];
  education: PDLEducation[];
  skills: string[];
}

export interface PDLExperience {
  company: { name: string | null; website: string | null } | null;
  title: { name: string | null } | null;
  start_date: string | null;
  end_date: string | null;
  is_primary: boolean | null;
  summary: string | null;
}

export interface PDLEducation {
  school: { name: string | null } | null;
  degrees: string[];
  majors: string[];
  start_date: string | null;
  end_date: string | null;
}

export interface PDLFundingRound {
  funding_type: string | null;
  money_raised: number | null;
  date: string | null;
  investor_names: string[] | null;
}

export interface PDLCompanyResult {
  name: string | null;
  display_name: string | null;
  size: string | null;
  employee_count: number | null;
  founded: number | null;
  industry: string | null;
  website: string | null;
  linkedin_url: string | null;
  summary: string | null;
  location: {
    name: string | null;
    country: string | null;
  } | null;
  tags: string[];
  naics: { industry: string | null }[] | null;
  type: string | null;
  total_funding_raised: number | null;
  latest_funding_stage: string | null;
  latest_funding_date: string | null;
  number_funding_rounds: number | null;
  funding_stages: string[] | null;
  funding_details: PDLFundingRound[] | null;
}

// ── Enrichment results bundled together ──────────────────────────

export interface PDLEnrichmentResult {
  person: PDLPersonResult | null;
  personError?: string;
  company: PDLCompanyResult | null;
  companyError?: string;
}

// ── Person Enrichment ────────────────────────────────────────────

async function enrichPerson(
  input: ParsedSearchInput
): Promise<{ data: PDLPersonResult | null; error?: string }> {
  if (!PDL_API_KEY) {
    return { data: null, error: "PDL_API_KEY not configured" };
  }

  if (!input.contactName) {
    return { data: null, error: "No contact name provided" };
  }

  // Split contact name into first/last
  const nameParts = input.contactName.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || undefined;

  const params = new URLSearchParams();
  params.set("first_name", firstName);
  if (lastName) params.set("last_name", lastName);
  params.set("company", input.companyName);
  if (input.contactTitle) params.set("job_title", input.contactTitle);
  if (input.contactLinkedIn) params.set("profile", input.contactLinkedIn);

  const url = `${PDL_BASE_URL}/person/enrich?${params.toString()}`;
  console.log(`[PDL] Person enrichment request: ${firstName} ${lastName || ""} @ ${input.companyName}`);

  try {
    const response = await fetch(url, {
      headers: { "X-Api-Key": PDL_API_KEY },
    });

    if (response.status === 404) {
      console.log("[PDL] No matching person found");
      return { data: null, error: "No matching person found in PDL" };
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PDL] Person enrichment error ${response.status}:`, text);
      return { data: null, error: `PDL API error: ${response.status}` };
    }

    const json = await response.json();
    console.log(`[PDL] Person enrichment matched: ${json.data?.full_name} (likelihood: ${json.likelihood})`);

    return { data: json.data as PDLPersonResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PDL] Person enrichment failed:", message);
    return { data: null, error: message };
  }
}

// ── Company Enrichment ───────────────────────────────────────────

async function enrichCompany(
  input: ParsedSearchInput
): Promise<{ data: PDLCompanyResult | null; error?: string }> {
  if (!PDL_API_KEY) {
    return { data: null, error: "PDL_API_KEY not configured" };
  }

  const params = new URLSearchParams();
  params.set("name", input.companyName);
  if (input.companyDomain) params.set("website", input.companyDomain);

  const url = `${PDL_BASE_URL}/company/enrich?${params.toString()}`;
  console.log(`[PDL] Company enrichment request: ${input.companyName}`);

  try {
    const response = await fetch(url, {
      headers: { "X-Api-Key": PDL_API_KEY },
    });

    if (response.status === 404) {
      console.log("[PDL] No matching company found");
      return { data: null, error: "No matching company found in PDL" };
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PDL] Company enrichment error ${response.status}:`, text);
      return { data: null, error: `PDL API error: ${response.status}` };
    }

    // Company enrichment returns fields at top level (not nested in data)
    const json = await response.json();
    console.log(`[PDL] Company enrichment matched: ${json.display_name || json.name} (likelihood: ${json.likelihood})`);

    return { data: json as PDLCompanyResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PDL] Company enrichment failed:", message);
    return { data: null, error: message };
  }
}

// ── Public API: enrich both in parallel ──────────────────────────

export async function enrichWithPDL(
  input: ParsedSearchInput
): Promise<PDLEnrichmentResult> {
  const [personResult, companyResult] = await Promise.all([
    enrichPerson(input),
    enrichCompany(input),
  ]);

  return {
    person: personResult.data,
    personError: personResult.error,
    company: companyResult.data,
    companyError: companyResult.error,
  };
}

// ── Email-based Person Lookup (lightweight — name + title only) ──

export interface PDLAttendeeResult {
  email: string;
  fullName: string | null;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
}

export async function enrichByEmail(email: string): Promise<PDLAttendeeResult | null> {
  if (!PDL_API_KEY) return null;

  try {
    const url = `${PDL_BASE_URL}/person/enrich?email=${encodeURIComponent(email)}`;
    console.log(`[PDL] Email enrichment: ${email}`);

    const response = await fetch(url, {
      headers: { "X-Api-Key": PDL_API_KEY },
    });

    if (!response.ok) {
      console.log(`[PDL] Email enrichment ${response.status} for ${email}`);
      return null;
    }

    const json = await response.json();
    const p = json.data;
    if (!p) return null;

    console.log(`[PDL] Email enrichment matched: ${p.full_name} — ${p.job_title} @ ${p.job_company_name}`);
    return {
      email,
      fullName: p.full_name || null,
      title: p.job_title || null,
      company: p.job_company_name || null,
      linkedinUrl: p.linkedin_url || null,
    };
  } catch (error) {
    console.error(`[PDL] Email enrichment failed for ${email}:`, error);
    return null;
  }
}

export async function enrichAttendeesByEmail(
  attendees: Array<{ name: string; email?: string }>
): Promise<Array<{ name: string; email?: string; title?: string; company?: string; linkedinUrl?: string }>> {
  const results = await Promise.all(
    attendees.map(async (a) => {
      if (!a.email) return a;
      const enriched = await enrichByEmail(a.email);
      if (!enriched) return a;
      return {
        name: enriched.fullName || a.name,
        email: a.email,
        title: enriched.title || undefined,
        company: enriched.company || undefined,
        linkedinUrl: enriched.linkedinUrl || undefined,
      };
    })
  );
  return results;
}

// ── Format PDL data as text for synthesis prompt ─────────────────

export function formatPDLForSynthesis(pdl: PDLEnrichmentResult): string {
  const sections: string[] = [];

  if (pdl.person) {
    const p = pdl.person;
    const lines: string[] = [];
    lines.push(`### Contact Profile: ${p.full_name || "Unknown"}`);
    if (p.job_title) lines.push(`- **Current Title:** ${p.job_title}`);
    if (p.job_company_name) lines.push(`- **Current Company:** ${p.job_company_name}`);
    if (p.industry) lines.push(`- **Industry:** ${p.industry}`);
    if (p.location_name) lines.push(`- **Location:** ${p.location_name}`);
    if (p.linkedin_url) lines.push(`- **LinkedIn:** ${p.linkedin_url}`);
    if (p.summary) lines.push(`- **Summary:** ${p.summary}`);

    if (p.experience?.length > 0) {
      lines.push("\n**Work Experience:**");
      for (const exp of p.experience.slice(0, 5)) {
        const title = exp.title?.name || "Unknown role";
        const company = exp.company?.name || "Unknown company";
        const dates = [exp.start_date, exp.end_date || "present"].filter(Boolean).join(" – ");
        lines.push(`- ${title} at ${company} (${dates})`);
      }
    }

    if (p.education?.length > 0) {
      lines.push("\n**Education:**");
      for (const edu of p.education.slice(0, 3)) {
        const school = edu.school?.name || "Unknown school";
        const degree = edu.degrees?.join(", ") || "";
        const major = edu.majors?.join(", ") || "";
        const parts = [school, degree, major].filter(Boolean);
        lines.push(`- ${parts.join(" — ")}`);
      }
    }

    if (p.skills?.length > 0) {
      lines.push(`\n**Skills & Technologies:** ${p.skills.join(", ")}`);
    }

    sections.push(lines.join("\n"));
  } else if (pdl.personError) {
    sections.push(`### Contact Profile\nNo data available (${pdl.personError})`);
  }

  if (pdl.company) {
    const c = pdl.company;
    const lines: string[] = [];
    lines.push(`### Company Profile: ${c.display_name || c.name || "Unknown Company"}`);
    if (c.summary) lines.push(`- **Description:** ${c.summary}`);
    if (c.industry) lines.push(`- **Industry:** ${c.industry}`);
    if (c.size) lines.push(`- **Size:** ${c.size}`);
    if (c.employee_count) lines.push(`- **Employee Count:** ${c.employee_count}`);
    if (c.founded) lines.push(`- **Founded:** ${c.founded}`);
    if (c.type) lines.push(`- **Type:** ${c.type}`);
    if (c.website) lines.push(`- **Website:** ${c.website}`);
    if (c.linkedin_url) lines.push(`- **LinkedIn:** ${c.linkedin_url}`);
    if (c.location?.name) lines.push(`- **HQ:** ${c.location.name}`);

    // Funding information
    if (c.total_funding_raised) {
      const formatted = c.total_funding_raised >= 1_000_000
        ? `$${(c.total_funding_raised / 1_000_000).toFixed(1)}M`
        : `$${(c.total_funding_raised / 1_000).toFixed(0)}K`;
      lines.push(`- **Total Funding Raised:** ${formatted}`);
    }
    if (c.latest_funding_stage) lines.push(`- **Latest Funding Stage:** ${c.latest_funding_stage}`);
    if (c.latest_funding_date) lines.push(`- **Latest Funding Date:** ${c.latest_funding_date}`);
    if (c.number_funding_rounds) lines.push(`- **Funding Rounds:** ${c.number_funding_rounds}`);
    if (c.funding_details && c.funding_details.length > 0) {
      lines.push("\n**Funding History:**");
      for (const round of c.funding_details.slice(0, 5)) {
        const type = round.funding_type || "Unknown";
        const amount = round.money_raised
          ? round.money_raised >= 1_000_000
            ? `$${(round.money_raised / 1_000_000).toFixed(1)}M`
            : `$${(round.money_raised / 1_000).toFixed(0)}K`
          : "undisclosed";
        const date = round.date || "unknown date";
        const investors = round.investor_names?.length
          ? ` — ${round.investor_names.join(", ")}`
          : "";
        lines.push(`- ${type}: ${amount} (${date})${investors}`);
      }
    }

    if (c.tags?.length > 0) lines.push(`- **Tags:** ${c.tags.join(", ")}`);
    sections.push(lines.join("\n"));
  } else if (pdl.companyError) {
    sections.push(`### Company Profile\nNo data available (${pdl.companyError})`);
  }

  return sections.join("\n\n---\n\n");
}

// ── Candidate assessment lookups ─────────────────────────────────
// Person-by-LinkedIn-URL and company-by-name/domain, used by the
// hiring candidate assessment (lib/hiring/candidate-assessment.ts).
// Kept here so every PDL call in the app shares one client, one key,
// and one logging convention.

/**
 * Enrich a person from a LinkedIn profile URL alone. PDL accepts the
 * URL via `profile`, which is how the candidate flow reads a public
 * profile without scraping LinkedIn (they block datacenter IPs and
 * their ToS forbids it).
 */
export async function enrichPersonByLinkedIn(
  linkedinUrl: string
): Promise<{ data: PDLPersonResult | null; error?: string }> {
  if (!PDL_API_KEY) return { data: null, error: "PDL_API_KEY not configured" };
  const cleaned = linkedinUrl.trim().replace(/\/+$/, "");
  if (!cleaned) return { data: null, error: "No LinkedIn URL provided" };

  const params = new URLSearchParams();
  params.set("profile", cleaned);
  // Ask PDL to only answer when it's reasonably sure it's the same
  // human — a wrong match here would grade the wrong person.
  params.set("min_likelihood", "6");

  try {
    const response = await fetch(`${PDL_BASE_URL}/person/enrich?${params.toString()}`, {
      headers: { "X-Api-Key": PDL_API_KEY },
    });
    if (response.status === 404) {
      return { data: null, error: "No matching profile found in PDL" };
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[PDL] Profile enrichment error ${response.status}:`, text);
      return { data: null, error: `PDL API error: ${response.status}` };
    }
    const json = await response.json();
    console.log(`[PDL] Profile matched: ${json.data?.full_name} (likelihood ${json.likelihood})`);
    return { data: json.data as PDLPersonResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PDL] Profile enrichment failed:", message);
    return { data: null, error: message };
  }
}

/** Company enrichment by name (and website when known). */
export async function enrichCompanyByNameOrDomain(
  name: string,
  website?: string | null
): Promise<PDLCompanyResult | null> {
  if (!PDL_API_KEY || !name?.trim()) return null;
  const params = new URLSearchParams();
  params.set("name", name.trim());
  if (website?.trim()) params.set("website", website.trim());
  try {
    const response = await fetch(`${PDL_BASE_URL}/company/enrich?${params.toString()}`, {
      headers: { "X-Api-Key": PDL_API_KEY },
    });
    if (!response.ok) return null;
    return (await response.json()) as PDLCompanyResult;
  } catch (error) {
    console.error(`[PDL] Company enrichment failed for ${name}:`, error);
    return null;
  }
}
