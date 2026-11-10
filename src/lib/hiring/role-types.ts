/**
 * The seats a hiring profile can describe.
 *
 * One question bank and one version table per seat, discriminated by
 * roleType, rather than a duplicated stack per role. The Sales Leader
 * profile predates this and still lives in its own models
 * (SalesLeaderProfileVersion) — it isn't listed here because nothing
 * routes to it through this path yet.
 */

export const HIRING_ROLE_TYPES = ["AE", "SDR", "CSM"] as const;
export type HiringRoleType = (typeof HIRING_ROLE_TYPES)[number];

export const DEFAULT_HIRING_ROLE: HiringRoleType = "AE";

export function isHiringRoleType(v: unknown): v is HiringRoleType {
  return typeof v === "string" && (HIRING_ROLE_TYPES as readonly string[]).includes(v);
}

/** Anything unrecognised falls back to AE, which is what every pre-existing row is. */
export function parseHiringRole(v: unknown): HiringRoleType {
  if (isHiringRoleType(v)) return v;
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return isHiringRoleType(s) ? s : DEFAULT_HIRING_ROLE;
}

export const ROLE_META: Record<
  HiringRoleType,
  { label: string; profileTitle: string; short: string; blurb: string }
> = {
  AE: {
    label: "Account Executive",
    profileTitle: "AE Hiring Profile",
    short: "AE",
    blurb: "The rep who runs deals end to end and carries a closing number.",
  },
  SDR: {
    label: "Sales Development Rep",
    profileTitle: "SDR Hiring Profile",
    short: "SDR",
    blurb: "The rep who creates pipeline — outbound, qualification, meetings booked.",
  },
  CSM: {
    label: "Customer Success Manager",
    profileTitle: "CSM Hiring Profile",
    short: "CSM",
    blurb: "The person who onboards, retains and expands customers after the sale.",
  },
};

/**
 * Map the free-form role label used by the candidate assessor onto a
 * profile seat.
 *
 * The assessor accepts AE / SDR / AM / CSM / Manager / VP, which is a
 * wider vocabulary than the profiles cover. AM maps to CSM because both
 * are post-sale account ownership; Manager and VP have no profile in
 * this stack (the Sales Leader profile is separate), so they fall back
 * to AE rather than silently grading against nothing.
 */
export function profileRoleForAssessment(roleLabel: string | null | undefined): HiringRoleType {
  const r = (roleLabel || "").trim().toUpperCase();
  if (r === "SDR" || r === "BDR") return "SDR";
  if (r === "CSM" || r === "AM" || r === "CS") return "CSM";
  return "AE";
}
