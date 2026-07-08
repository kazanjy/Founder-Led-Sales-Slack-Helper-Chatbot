"use client";

import { useEffect, useMemo, useState } from "react";
// Type-only import — erased at compile time, so the server-only module
// (openai/prisma imports) never enters the client bundle.
import type {
  OutcomeCandidate,
  OutcomeCandidatesBlob,
} from "@/lib/coaching/extract-outcomes";

/**
 * Review surface for implicit goal tracking. Renders as a quiet chip
 * on the session view ("Mikey spotted N suggested updates") that opens
 * a modal where the founder accepts/dismisses each candidate. Nothing
 * touches real goals/tasks until "Apply" fires the commit endpoint.
 *
 * Grouping is deliberate: completions/status changes first (the
 * high-precision, high-delight half), then new tasks under existing
 * goals, then new goals with their nested tasks.
 */

interface ActiveGoalOption {
  id: string;
  title: string;
}

interface RowDecision {
  action?: "accept" | "reject";
  title?: string;
  goalId?: string;
}

interface OutcomeReviewPanelProps {
  sessionId: string;
  /** Owner of the session — goals dropdown loads THEIR active goals. */
  sessionUserId: string;
  blob: OutcomeCandidatesBlob | null;
  /** True while the post-save extraction job is still running. */
  extracting: boolean;
  /** Called after a successful commit so the page can refresh state. */
  onCommitted: () => void | Promise<void>;
}

const STATUS_LABELS: Record<string, string> = {
  done: "done",
  not_doing: "not doing",
  deprioritized: "deprioritized",
};

function ConfidenceBadge({ level }: { level: OutcomeCandidate["confidence"] }) {
  const styles =
    level === "high"
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : level === "low"
        ? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${styles}`}>
      {level}
    </span>
  );
}

function Evidence({ quote }: { quote: string }) {
  return (
    <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400 border-l-2 border-purple-200 dark:border-purple-800 pl-2">
      &ldquo;{quote}&rdquo;
    </p>
  );
}

function AcceptRejectToggle({
  value,
  onChange,
  disabled,
}: {
  value?: "accept" | "reject";
  onChange: (v: "accept" | "reject") => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex gap-1 shrink-0 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <button
        onClick={() => onChange("accept")}
        className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
          value === "accept"
            ? "bg-green-600 text-white"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/40"
        }`}
      >
        ✓ Accept
      </button>
      <button
        onClick={() => onChange("reject")}
        className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
          value === "reject"
            ? "bg-gray-600 text-white"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
      >
        ✕ Dismiss
      </button>
    </div>
  );
}

export function OutcomeReviewPanel({
  sessionId,
  sessionUserId,
  blob,
  extracting,
  onCommitted,
}: OutcomeReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGoals, setActiveGoals] = useState<ActiveGoalOption[]>([]);

  const pending = useMemo(
    () => (blob?.candidates || []).filter((c) => c.status === "pending"),
    [blob]
  );
  const pendingIds = useMemo(() => new Set(pending.map((c) => c.id)), [pending]);

  // Group for display. New-goal candidates carry their nested task
  // candidates (parentCandidateId) so they render as one card.
  const updates = pending.filter((c) => c.kind === "update_task" || c.kind === "update_goal");
  const newTasks = pending.filter((c) => c.kind === "new_task" && !c.parentCandidateId);
  const newGoals = pending.filter((c) => c.kind === "new_goal" || c.kind === "new_next_goal");
  const childrenOf = (goalCandidateId: string) =>
    pending.filter((c) => c.parentCandidateId === goalCandidateId);

  // Load the session owner's active goals for the "under goal" dropdown
  // only once the modal opens — the chip itself needs no data.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/coaching/goals?status=active&userId=${encodeURIComponent(sessionUserId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setActiveGoals(
              (data.goals || []).map((g: { id: string; title: string }) => ({
                id: g.id,
                title: g.title,
              }))
            );
          }
        }
      } catch {
        /* dropdown falls back to the extracted goal only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionUserId]);

  // Reset row state when a fresh extraction replaces the blob.
  useEffect(() => {
    setDecisions({});
  }, [blob?.extractedAt]);

  if (!extracting && pending.length === 0) return null;

  const setRow = (id: string, patch: Partial<RowDecision>) =>
    setDecisions((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const decidedCount = pending.filter((c) => decisions[c.id]?.action).length;

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const payload = pending
        .filter((c) => {
          const own = decisions[c.id]?.action;
          if (own) return true;
          // Children of a rejected new-goal candidate get auto-rejected.
          return !!(
            c.parentCandidateId &&
            pendingIds.has(c.parentCandidateId) &&
            decisions[c.parentCandidateId]?.action === "reject"
          );
        })
        .map((c) => {
          const d = decisions[c.id] || {};
          const parentRejected =
            c.parentCandidateId && decisions[c.parentCandidateId]?.action === "reject";
          return {
            candidateId: c.id,
            action: parentRejected ? ("reject" as const) : d.action!,
            ...(d.title && d.title.trim() && d.title.trim() !== c.title
              ? { title: d.title.trim() }
              : {}),
            ...(d.goalId && d.goalId !== c.goalId ? { goalId: d.goalId } : {}),
          };
        });
      const res = await fetch(`/api/coaching-sessions/${sessionId}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Commit failed (${res.status})`);
      }
      setOpen(false);
      setDecisions({});
      await onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply decisions");
    } finally {
      setCommitting(false);
    }
  };

  const renderEditableTitle = (c: OutcomeCandidate) => (
    <input
      type="text"
      value={decisions[c.id]?.title ?? c.title ?? ""}
      onChange={(e) => setRow(c.id, { title: e.target.value })}
      className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-400"
    />
  );

  return (
    <>
      {/* ── Chip ───────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
          {extracting && pending.length === 0 ? (
            <>
              <svg
                className="animate-spin w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span className="animate-pulse">Scanning session for goal &amp; task updates…</span>
            </>
          ) : (
            <>
              <span>🎯</span>
              <span>
                Mikey spotted <strong>{pending.length}</strong> suggested goal/task
                {pending.length === 1 ? " update" : " updates"} in this session
              </span>
            </>
          )}
        </div>
        {pending.length > 0 && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
          >
            Review
          </button>
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Suggested goal &amp; task updates
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Inferred from this session&rsquo;s notes and transcript. Nothing changes until you apply.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-4 space-y-6">
              {updates.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                    Looks done / status changes
                  </h4>
                  <div className="space-y-3">
                    {updates.map((c) => (
                      <div key={c.id} className="flex items-start justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 dark:text-gray-100">
                            Mark {c.kind === "update_goal" ? "goal" : "task"}{" "}
                            <strong>&ldquo;{c.targetTitle || c.targetId}&rdquo;</strong> as{" "}
                            <span className="font-medium text-purple-700 dark:text-purple-300">
                              {STATUS_LABELS[c.newStatus || ""] || c.newStatus}
                            </span>{" "}
                            <ConfidenceBadge level={c.confidence} />
                          </p>
                          {/* Where the task lives, so the founder can
                              tell apart same-named tasks under different
                              goals. Goal › parent-task when it's a
                              subtask, just the goal otherwise. Goals
                              themselves are top-level — no breadcrumb. */}
                          {c.kind === "update_task" && c.parentGoalTitle && (
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                              </svg>
                              <span className="truncate">
                                {c.parentGoalTitle}
                                {c.parentTaskTitle ? ` › ${c.parentTaskTitle}` : ""}
                              </span>
                            </p>
                          )}
                          <Evidence quote={c.evidence} />
                        </div>
                        <AcceptRejectToggle
                          value={decisions[c.id]?.action}
                          onChange={(v) => setRow(c.id, { action: v })}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {newTasks.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                    New tasks
                  </h4>
                  <div className="space-y-3">
                    {newTasks.map((c) => (
                      <div key={c.id} className="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {renderEditableTitle(c)}
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <span>under goal</span>
                              <select
                                value={decisions[c.id]?.goalId ?? c.goalId ?? ""}
                                onChange={(e) => setRow(c.id, { goalId: e.target.value })}
                                className="px-1.5 py-0.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 max-w-[240px]"
                              >
                                {/* Extracted parent stays available even if
                                    the goals fetch fails */}
                                {c.goalId && !activeGoals.some((g) => g.id === c.goalId) && (
                                  <option value={c.goalId}>{c.goalTitle || "Original goal"}</option>
                                )}
                                {activeGoals.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.title}
                                  </option>
                                ))}
                              </select>
                              <ConfidenceBadge level={c.confidence} />
                            </div>
                            <Evidence quote={c.evidence} />
                          </div>
                          <AcceptRejectToggle
                            value={decisions[c.id]?.action}
                            onChange={(v) => setRow(c.id, { action: v })}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {newGoals.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                    New goals
                  </h4>
                  <div className="space-y-3">
                    {newGoals.map((g) => {
                      const kids = childrenOf(g.id);
                      const goalRejected = decisions[g.id]?.action === "reject";
                      return (
                        <div key={g.id} className="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                  {g.kind === "new_next_goal" ? "Up Next" : "Goal"}
                                </span>
                                <ConfidenceBadge level={g.confidence} />
                              </div>
                              {renderEditableTitle(g)}
                              {g.description && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{g.description}</p>
                              )}
                              <Evidence quote={g.evidence} />
                            </div>
                            <AcceptRejectToggle
                              value={decisions[g.id]?.action}
                              onChange={(v) => setRow(g.id, { action: v })}
                            />
                          </div>
                          {kids.length > 0 && (
                            <div className="ml-4 pl-3 border-l-2 border-gray-200 dark:border-gray-600 space-y-2">
                              {kids.map((t) => (
                                <div key={t.id} className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">{renderEditableTitle(t)}</div>
                                  <AcceptRejectToggle
                                    value={goalRejected ? "reject" : decisions[t.id]?.action}
                                    onChange={(v) => setRow(t.id, { action: v })}
                                    disabled={goalRejected}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>

            <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 px-6 py-3 flex items-center justify-between rounded-b-2xl">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {error ? (
                  <span className="text-red-600 dark:text-red-400">{error}</span>
                ) : (
                  <>Undecided suggestions stay pending for later.</>
                )}
              </p>
              <button
                onClick={handleCommit}
                disabled={committing || decidedCount === 0}
                className="px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {committing ? "Applying…" : `Apply ${decidedCount || ""} decision${decidedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
