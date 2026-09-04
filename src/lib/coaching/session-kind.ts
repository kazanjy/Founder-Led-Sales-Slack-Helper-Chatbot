/**
 * Coaching session kinds, and the one rule that makes ad-hoc work.
 *
 * An ad-hoc session is a real coaching session in every respect that a
 * founder would notice — it appears in history, gets a synthesis,
 * extracts goals and tasks, can be chatted about. The single thing it
 * does NOT do is participate in metrics.
 *
 * That exclusion has to happen in three places, and missing any one of
 * them produces wrong numbers rather than merely missing ones:
 *
 * 1. Session creation seeds a zero-value entry for every active metric.
 *    An ad-hoc session must skip that, because a stray 0 becomes the
 *    "previous value" for the next real session — which would then
 *    report the entire cumulative total as "added since last."
 * 2. The previous-entry lookup that computes `addedSinceLastSession`.
 * 3. The history series behind the sparkline, which would otherwise
 *    show a crater to zero and back.
 *
 * Filtering in the QUERIES rather than only at write time is what lets
 * the toggle be flipped after the fact: marking an existing session
 * ad-hoc immediately removes it from the chain, with no cleanup pass
 * and nothing deleted. Flipping it back restores it.
 */

export type SessionKind = "standard" | "ad_hoc";

export const SESSION_KINDS: SessionKind[] = ["standard", "ad_hoc"];

export function isSessionKind(v: unknown): v is SessionKind {
  return typeof v === "string" && (SESSION_KINDS as string[]).includes(v);
}

/** Anything not explicitly ad-hoc counts — including legacy null rows. */
export function countsTowardMetrics(kind: string | null | undefined): boolean {
  return kind !== "ad_hoc";
}

/**
 * The `where.session` fragment that keeps a metric query on the real
 * measurement cadence. Drafts were already excluded here; ad-hoc
 * sessions join them.
 *
 * Exported as one object so the delta lookup and the history series
 * cannot fall out of step — they must agree, or the sparkline and the
 * "since last" figure will tell the founder two different stories.
 */
export const METRIC_ELIGIBLE_SESSION = {
  notes: { not: "(draft)" },
  sessionKind: { not: "ad_hoc" },
} as const;

/** Short label for the history list and session header. */
export function sessionKindLabel(kind: string | null | undefined): string | null {
  return kind === "ad_hoc" ? "Ad hoc" : null;
}
