/**
 * Business Cases suite — shared constants. Client-safe (no server
 * imports): the applet page, deal page, and server libs all read from
 * here so the three artifact types stay in lockstep.
 */

export const BUSINESS_CASE_TYPES = [
  "discovery_summary",
  "roi_model",
  "business_case",
] as const;

export type BusinessCaseType = (typeof BUSINESS_CASE_TYPES)[number];

export function isBusinessCaseType(v: unknown): v is BusinessCaseType {
  return (
    typeof v === "string" &&
    (BUSINESS_CASE_TYPES as readonly string[]).includes(v)
  );
}

export const BC_TYPE_INFO: Record<
  BusinessCaseType,
  {
    label: string;
    plural: string;
    emoji: string;
    description: string;
    /** Phase gating — tabs render but generation is disabled. */
    available: boolean;
  }
> = {
  discovery_summary: {
    label: "Discovery Summary",
    plural: "Discovery Summaries",
    emoji: "🔎",
    description:
      "The opportunity as we understand it today — situation, pains, quantified impact, stakeholders, decision process, and what's still unknown. Built from your discovery framework and filled from real call evidence.",
    available: true,
  },
  roi_model: {
    label: "ROI Model",
    plural: "ROI Models",
    emoji: "💰",
    description:
      "An economic model of what your product delivers — value drivers, assumptions, math, and payback — derived from your sales narrative's value argument and filled with the customer's own numbers.",
    available: false,
  },
  business_case: {
    label: "Business Case",
    plural: "Business Cases",
    emoji: "📈",
    description:
      "The composed document a champion carries to their economic buyer — current state, proposed solution, economics, risks, and recommendation. Composes the deal's Discovery Summary and ROI Model.",
    available: false,
  },
};
