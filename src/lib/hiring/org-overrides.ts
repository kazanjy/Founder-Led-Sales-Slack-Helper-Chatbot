import { prisma } from "@/lib/db";
import type { OrgOverride } from "./sales-org-registry";

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

/** Fail-safe: any read or parse error yields no overrides, never a throw. */
export async function getOrgOverrides(userId: string): Promise<OrgOverride[]> {
  try {
    const row = await prisma.gtmVariable.findFirst({
      where: { userId, mergeField: MERGE_FIELD },
      select: { value: true },
    });
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
