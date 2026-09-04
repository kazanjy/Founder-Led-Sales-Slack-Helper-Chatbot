/**
 * Aggregations and formatters for the "closed deal summary" block
 * surfaced on both the deals list and the deal detail page when a
 * deal's status is closed_won or closed_lost. Keeps the two surfaces
 * computing the same numbers from the same fields.
 */

export interface ClosedDealStats {
  createdAt: string;
  closeDate: string | null;
  cycleDays: number | null;
  recordedCallCount: number;
  engagedStakeholders: number;
}

export function isClosedStatus(status: string): boolean {
  return status === "closed_won" || status === "closed_lost";
}

function diffDays(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

export function computeClosedDealStats(input: {
  createdAt: string | Date;
  closeDate: string | Date | null;
  recordedCallCount: number;
  engagedStakeholders: number;
}): ClosedDealStats {
  const created = typeof input.createdAt === "string" ? new Date(input.createdAt) : input.createdAt;
  const closed = input.closeDate
    ? typeof input.closeDate === "string"
      ? new Date(input.closeDate)
      : input.closeDate
    : null;
  return {
    createdAt: created.toISOString(),
    closeDate: closed ? closed.toISOString() : null,
    cycleDays: closed ? diffDays(closed, created) : null,
    recordedCallCount: input.recordedCallCount,
    engagedStakeholders: input.engagedStakeholders,
  };
}

export function formatClosedDealDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Count UNIQUE recorded meetings on a deal. A single meeting can
// produce both a call_summary entry AND a call_transcript entry
// (often with different titles — "Pete / Rami Catch Up" from a
// calendar invite vs "Fathom Recording" from the recorder) and a
// time gap of a few minutes-to-hours between landing. Title-match
// or exact-time match misses these; we cluster instead:
//
//   1) Entries sharing a metadata.providerCallId always collapse to
//      one meeting, even if the time gap is huge.
//   2) Otherwise: walk entries by entryDate and merge into the
//      previous cluster if within CLUSTER_WINDOW_MS — currently
//      4 hours — of the cluster's most recent entry. 4h is long
//      enough to catch a transcript landing after the summary but
//      short enough that two separate same-day calls stay distinct.
//   3) Falls through to a fresh cluster otherwise.
const CLUSTER_WINDOW_MS = 4 * 60 * 60 * 1000;

export function countUniqueMeetings(entries: Array<{
  id: string;
  type: string;
  title: string | null;
  entryDate: string | Date;
  metadata: string | null;
}>): number {
  type Eligible = { id: string; ts: number; providerCallId: string | null };
  const eligible: Eligible[] = [];
  for (const e of entries) {
    if (e.type !== "call_summary" && e.type !== "call_transcript") continue;
    const when = typeof e.entryDate === "string" ? new Date(e.entryDate) : e.entryDate;
    const ts = when.getTime();
    if (!Number.isFinite(ts)) continue;
    let providerCallId: string | null = null;
    if (e.metadata) {
      try {
        const m = JSON.parse(e.metadata) as { providerCallId?: unknown };
        if (typeof m.providerCallId === "string" && m.providerCallId.trim()) {
          providerCallId = m.providerCallId.trim();
        }
      } catch { /* ignore */ }
    }
    eligible.push({ id: e.id, ts, providerCallId });
  }
  if (eligible.length === 0) return 0;

  // Pre-collapse by providerCallId so the time-window pass treats
  // them as one logical event regardless of when each entry landed.
  const byProviderId = new Map<string, number>();
  const clusterTimes: number[][] = []; // cluster idx → list of entry ts
  for (const e of eligible) {
    if (e.providerCallId) {
      const existing = byProviderId.get(e.providerCallId);
      if (existing != null) {
        clusterTimes[existing].push(e.ts);
        continue;
      }
      const idx = clusterTimes.length;
      byProviderId.set(e.providerCallId, idx);
      clusterTimes.push([e.ts]);
    } else {
      clusterTimes.push([e.ts]);
    }
  }

  // Second pass: merge clusters whose time ranges overlap within the
  // 4-hour window. Each cluster's "footprint" is [min, max] of its
  // entries; two clusters merge if their footprints come within
  // CLUSTER_WINDOW_MS of each other.
  const clusters = clusterTimes
    .map((times) => ({ min: Math.min(...times), max: Math.max(...times) }))
    .sort((a, b) => a.min - b.min);

  let merged = 0;
  let prev: { min: number; max: number } | null = null;
  for (const c of clusters) {
    if (prev && c.min - prev.max <= CLUSTER_WINDOW_MS) {
      prev.max = Math.max(prev.max, c.max);
      continue;
    }
    merged++;
    prev = { min: c.min, max: c.max };
  }
  return merged;
}

// Open-deal stats — operational rather than retrospective. Surfaced
// on both /deals (right rail) and /deals/[id] (top of detail) for
// deals whose status isn't closed_won / closed_lost. Each stat is
// chosen to be a glance-able health signal:
//   - daysOpen:           overall age. Sets context.
//   - daysInStage:        single best stall signal. Computed from
//                         the most recent stage_change entry; falls
//                         back to daysOpen when the deal never
//                         moved stages.
//   - recordedCallCount:  engagement depth.
//   - engagedStakeholders: single-threaded risk signal.
export interface OpenDealStats {
  daysOpen: number;
  daysInStage: number;
  recordedCallCount: number;
  engagedStakeholders: number;
}

export function computeOpenDealStats(input: {
  createdAt: string | Date;
  stageEnteredAt: string | Date | null;
  recordedCallCount: number;
  engagedStakeholders: number;
}): OpenDealStats {
  const now = new Date();
  const created = typeof input.createdAt === "string" ? new Date(input.createdAt) : input.createdAt;
  const stageEntered = input.stageEnteredAt
    ? typeof input.stageEnteredAt === "string"
      ? new Date(input.stageEnteredAt)
      : input.stageEnteredAt
    : created;
  return {
    daysOpen: diffDays(now, created),
    daysInStage: diffDays(now, stageEntered),
    recordedCallCount: input.recordedCallCount,
    engagedStakeholders: input.engagedStakeholders,
  };
}
