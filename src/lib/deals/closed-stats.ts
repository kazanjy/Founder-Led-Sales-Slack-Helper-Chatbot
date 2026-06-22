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
// (the recorder gives us the summary; a user might separately
// paste the transcript) — naïvely counting either type alone
// undercounts, and counting both double-counts. Dedupe key:
//   1) metadata.providerCallId when present (most reliable —
//      written by scan-recordings + the bulk-import flow)
//   2) Otherwise normalized title + minute-precision entryDate
//      (good enough fallback for hand-pasted entries from the
//      same call)
//   3) Otherwise the entry's own id (never collides — last
//      resort so we don't drop a real meeting).
export function countUniqueMeetings(entries: Array<{
  id: string;
  type: string;
  title: string | null;
  entryDate: string | Date;
  metadata: string | null;
}>): number {
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.type !== "call_summary" && e.type !== "call_transcript") continue;
    let key: string | null = null;
    if (e.metadata) {
      try {
        const m = JSON.parse(e.metadata) as { providerCallId?: unknown };
        if (typeof m.providerCallId === "string" && m.providerCallId.trim()) {
          key = `pcid:${m.providerCallId.trim()}`;
        }
      } catch { /* ignore */ }
    }
    if (!key) {
      const when = typeof e.entryDate === "string" ? new Date(e.entryDate) : e.entryDate;
      // Round to the minute — call_summary + call_transcript from
      // the same import flow share entryDate exactly, but a user
      // hand-pasting a transcript later might be off by seconds.
      const minuteIso = isNaN(when.getTime())
        ? "invalid"
        : new Date(Math.floor(when.getTime() / 60000) * 60000).toISOString();
      const title = (e.title || "").trim().toLowerCase();
      if (title) {
        key = `tm:${minuteIso}|${title}`;
      }
    }
    if (!key) key = `id:${e.id}`;
    seen.add(key);
  }
  return seen.size;
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
