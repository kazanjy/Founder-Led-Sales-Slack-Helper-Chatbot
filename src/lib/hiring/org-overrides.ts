import { prisma } from "@/lib/db";
import type { OrgOverride } from "./sales-org-registry";
import type { SchoolOverride } from "./school-registry";

/**
 * Per-account additions to the well-regarded sales org registry.
 *
 * The seed registry can only ever hold the orgs everyone has heard of.
 * The entries with the most signal are the ones we would never guess:
 * the regional payroll company that everyone in that city knows trains
 * ferociously, the vertical SaaS leader in a niche of 400 buyers. The
 * founder knows those and we don't, so their list is a first-class
 * input rather than a footnote.
 *
 * Stored as a GtmVariable singleton — same no-migration pattern as
 * DEAL_SLACK_TONE and DEAL_ALERT_PREFS.
 */

const MERGE_FIELD = "HIGH_BAR_SALES_ORGS";
const MAX_OVERRIDES = 100;

/**
 * Own row first, then the newest one anywhere in the account. These
 * lists describe the COMPANY's hiring bar, not one person's, so a
 * teammate running an assessment has to see what the founder curated —
 * the same own-then-account shape lib/seller-context.ts uses.
 */
async function readAccountScoped(
  userId: string,
  accountId: string | null,
  mergeField: string
): Promise<{ value: string | null } | null> {
  const own = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField },
    select: { value: true },
  });
  if (own?.value?.trim() || !accountId) return own;
  return prisma.gtmVariable.findFirst({
    where: { mergeField, user: { accountId }, NOT: { value: null } },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
}

/** Fail-safe: any read or parse error yields no overrides, never a throw. */
export async function getOrgOverrides(
  userId: string,
  accountId?: string | null
): Promise<OrgOverride[]> {
  try {
    const row = await readAccountScoped(userId, accountId ?? null, MERGE_FIELD);
    const raw = row?.value?.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o) => o && typeof o === "object" && typeof o.name === "string" && o.name.trim())
      .slice(0, MAX_OVERRIDES)
      .map((o) => ({
        name: String(o.name).trim(),
        tier: o.tier === "elite" ? ("elite" as const) : ("strong" as const),
        basis: typeof o.basis === "string" && o.basis.trim() ? o.basis.trim() : undefined,
      }));
  } catch {
    return [];
  }
}

export async function setOrgOverrides(
  userId: string,
  overrides: OrgOverride[]
): Promise<OrgOverride[]> {
  const clean = overrides
    .filter((o) => o.name?.trim())
    .slice(0, MAX_OVERRIDES)
    .map((o) => ({
      name: o.name.trim().slice(0, 120),
      tier: o.tier === "elite" ? ("elite" as const) : ("strong" as const),
      ...(o.basis?.trim() ? { basis: o.basis.trim().slice(0, 400) } : {}),
    }));

  const existing = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: MERGE_FIELD },
    select: { id: true },
  });
  const value = JSON.stringify(clean);
  if (existing) {
    await prisma.gtmVariable.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.gtmVariable.create({
      // `name` is required on the model and is what the GTM variables UI
      // lists; this row is machine-managed, so it gets a stable label.
      data: { userId, name: "High-bar sales orgs", mergeField: MERGE_FIELD, value },
    });
  }
  return clean;
}

// ── School overrides ────────────────────────────────────────────────

const SCHOOL_FIELD = "HIGH_BAR_SCHOOLS";

/**
 * Per-account additions to the school selectivity registry.
 *
 * More load-bearing than the org equivalent, because the seed list is
 * unavoidably US-centric: a founder hiring in Munich or São Paulo has
 * a completely different and equally valid set, and a shipped list
 * shouldn't silently define the bar for them.
 */
export async function getSchoolOverrides(
  userId: string,
  accountId?: string | null
): Promise<SchoolOverride[]> {
  try {
    const row = await readAccountScoped(userId, accountId ?? null, SCHOOL_FIELD);
    const raw = row?.value?.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o) => o && typeof o === "object" && typeof o.name === "string" && o.name.trim())
      .slice(0, MAX_OVERRIDES)
      .map((o) => ({
        name: String(o.name).trim(),
        domain: typeof o.domain === "string" && o.domain.trim() ? o.domain.trim() : undefined,
        tier: o.tier === "elite" ? ("elite" as const) : ("selective" as const),
      }));
  } catch {
    return [];
  }
}

export async function setSchoolOverrides(
  userId: string,
  overrides: SchoolOverride[]
): Promise<SchoolOverride[]> {
  const clean = overrides
    .filter((o) => o.name?.trim())
    .slice(0, MAX_OVERRIDES)
    .map((o) => ({
      name: o.name.trim().slice(0, 160),
      ...(o.domain?.trim() ? { domain: o.domain.trim().slice(0, 120) } : {}),
      tier: o.tier === "elite" ? ("elite" as const) : ("selective" as const),
    }));

  const existing = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: SCHOOL_FIELD },
    select: { id: true },
  });
  const value = JSON.stringify(clean);
  if (existing) {
    await prisma.gtmVariable.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.gtmVariable.create({
      data: { userId, name: "High-bar schools", mergeField: SCHOOL_FIELD, value },
    });
  }
  return clean;
}
