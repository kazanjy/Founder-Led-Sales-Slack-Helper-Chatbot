/**
 * Saved sourcing searches: running them, storing them, reading them back.
 *
 * The load-bearing rule here is that RE-RUNNING A SEARCH MERGES rather
 * than replaces. Leads are unique on (searchId, apolloId), so a second
 * run updates what Apollo now says and leaves the enrichment columns
 * alone. Replacing would throw away credits already spent on exactly
 * the people the founder cared enough to enrich, and would reset their
 * triage status to boot.
 */

import { prisma } from "@/lib/db";
import { searchPeople, type ApolloLead } from "@/lib/search/apollo";

export interface SourcingCompany {
  name: string;
  tier: number;
  group: string | null;
  apolloOrgId: string;
}

export interface SourcingCriteria {
  roleType: string;
  companies: SourcingCompany[];
  titles: string[];
  locations: string[];
  modes: string[];
  yoeMin?: number | null;
  yoeMax?: number | null;
}

/** Reads criteria back off a stored row, tolerating older/partial JSON. */
export function criteriaFromRow(row: {
  roleType: string;
  companies: unknown;
  titles: unknown;
  locations: unknown;
  modes: unknown;
  yoeMin: number | null;
  yoeMax: number | null;
}): SourcingCriteria {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    roleType: row.roleType,
    companies: arr<SourcingCompany>(row.companies),
    titles: arr<string>(row.titles),
    locations: arr<string>(row.locations),
    modes: arr<string>(row.modes),
    yoeMin: row.yoeMin,
    yoeMax: row.yoeMax,
  };
}

/**
 * A name for a search nobody bothered to name.
 *
 * Built from the companies rather than the titles, because "Ex-
 * RevenueCat, Superwall +3" identifies a hunt where "Account Executive"
 * describes every hunt.
 */
export function deriveSearchName(criteria: SourcingCriteria): string {
  const names = criteria.companies.map((c) => c.name).filter(Boolean);
  const prefix = criteria.modes.includes("alumni") && !criteria.modes.includes("current")
    ? "Ex-"
    : "";
  if (names.length === 0) return `${criteria.roleType} search`;
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return `${prefix}${shown}${rest > 0 ? ` +${rest}` : ""} · ${criteria.roleType}`;
}

export interface RunResult {
  leads: Array<ApolloLead & { via: string[] }>;
  total: number;
  totals: Record<string, number>;
  errors: string[];
}

/**
 * Run the Apollo queries for a set of criteria.
 *
 * One query per mode, unioned on person id. Apollo takes current and
 * past employer as separate parameters and it is not established
 * whether it ANDs or ORs them when both are present; if it ANDs, a
 * combined request asks for "currently AND previously at the same
 * company" — almost nobody — and fails silently with a plausible empty
 * result. Two queries are correct either way.
 */
export async function runSourcingSearch(
  criteria: SourcingCriteria,
  perPage = 50
): Promise<RunResult> {
  const orgIds = criteria.companies.map((c) => c.apolloOrgId).filter(Boolean);
  const merged = new Map<string, ApolloLead & { via: string[] }>();
  const totals: Record<string, number> = {};
  const errors: string[] = [];

  const shared = {
    titles: criteria.titles,
    personLocations: criteria.locations.length ? criteria.locations : undefined,
    totalYearsExperience:
      criteria.yoeMin != null || criteria.yoeMax != null
        ? { min: criteria.yoeMin ?? undefined, max: criteria.yoeMax ?? undefined }
        : undefined,
    // Apollo widens loose titles by default, which drags Enterprise AEs
    // into a commercial / mid-market search.
    includeSimilarTitles: false,
    perPage,
  };

  for (const mode of criteria.modes) {
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
      // Someone can legitimately appear in both — a rep who left and
      // later returned — so keep both tags.
      if (existing) {
        if (!existing.via.includes(mode)) existing.via.push(mode);
      } else {
        merged.set(lead.id, { ...lead, via: [mode] });
      }
    }
  }

  return {
    leads: [...merged.values()],
    total: Object.values(totals).reduce((a, b) => a + b, 0),
    totals,
    errors,
  };
}

/**
 * Write a run's leads onto a search.
 *
 * Upserts on (searchId, apolloId): the identity fields are refreshed
 * from Apollo, and the enrichment and triage columns are deliberately
 * NOT in the update set, so a re-run never discards a paid enrichment
 * or a decision someone already made about a person.
 */
export async function persistLeads(
  searchId: string,
  userId: string,
  leads: Array<ApolloLead & { via: string[] }>
): Promise<number> {
  for (const lead of leads) {
    const identity = {
      firstName: lead.firstName,
      lastNameMasked: lead.lastNameMasked,
      title: lead.title,
      organizationName: lead.organizationName,
      via: lead.via,
    };
    await prisma.sourcingLead.upsert({
      where: { searchId_apolloId: { searchId, apolloId: lead.id } },
      update: identity,
      create: { searchId, userId, apolloId: lead.id, ...identity },
    });
  }
  return leads.length;
}

/**
 * Scope for reading a search.
 *
 * Account is the tenant boundary when the user has one, matching the
 * assessor: a teammate who didn't personally run the search still sees
 * the account's, and nobody ever sees another account's.
 */
export function searchScope(user: { id: string; accountId: string | null }) {
  return user.accountId ? { user: { accountId: user.accountId } } : { userId: user.id };
}
