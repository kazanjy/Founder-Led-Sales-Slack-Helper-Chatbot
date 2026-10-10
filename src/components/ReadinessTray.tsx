"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface ReadinessItem {
  id: string;
  title: string;
  description: string | null;
  order: number;
  status: string;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  completedAt: string | null;
  notes: string | null;
  evidenceUrl: string | null;
  mikeyLinks: Array<{ label: string; href: string }> | null;
}interface Category {
  name: string;
  items: ReadinessItem[];
  doneCount: number;
  totalCount: number;
}

interface Stage {
  key: string;
  label: string;
  question: string;
  categories: Category[];
  doneCount: number;
  totalCount: number;
}

interface ReadinessResponse {
  stages: Stage[];
  currentMaturityStage: string | null;
}

const STATUS_OPTIONS = [
  { value: "to_do", label: "To Do", icon: "○", color: "bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600" },
  { value: "up_next", label: "Up Next", icon: "⏭", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200" },
  { value: "in_progress", label: "In Progress", icon: "🔨", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
  { value: "done", label: "Done", icon: "✅", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200" },
  { value: "deferred", label: "Deferred", icon: "⏸", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
  { value: "not_doing", label: "Not Doing", icon: "✗", color: "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400" },
];

const FILTER_DEFAULT = new Set(["to_do", "up_next", "in_progress"]);

function statusOpt(v: string) {
  return STATUS_OPTIONS.find((s) => s.value === v) || STATUS_OPTIONS[0];
}

interface NextGoalShape {
  id: string;
  title: string;
  description?: string | null;
  order: number;
  createdAt?: string;
  tasks: Array<{ id: string; title: string; description?: string | null; order: number }>;
}

export default function ReadinessTray({
  open,
  onOpen,
  onClose,
  canEdit,
  onAddedAsNextGoal,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  canEdit: boolean;
  onAddedAsNextGoal?: (goal: NextGoalShape) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(FILTER_DEFAULT));
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [pendingItem, setPendingItem] = useState<string | null>(null);
  const [addedItemIds, setAddedItemIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales-readiness");
      if (res.ok) {
        const d: ReadinessResponse = await res.json();
        setData(d);
        // Default expansion: just the current stage. Falls back to the
        // first stage with any non-done work if no current stage is set.
        const expand = new Set<string>();
        if (d.currentMaturityStage) {
          expand.add(d.currentMaturityStage);
        } else {
          const first = d.stages.find((s) => s.doneCount < s.totalCount);
          if (first) expand.add(first.key);
        }
        setExpandedStages(expand);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data) load();
  }, [open, data, load]);

  // Esc closes the tray
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggleStage = (key: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilter = (val: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const cycleStatus = async (item: ReadinessItem) => {
    if (!canEdit) return;
    const order = ["to_do", "up_next", "in_progress", "done"];
    const idx = order.indexOf(item.status);
    const next = order[(idx + 1) % order.length];
    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: prev.stages.map((s) => ({
          ...s,
          categories: s.categories.map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === item.id ? { ...i, status: next } : i)),
          })),
        })),
      };
    });
    try {
      await fetch(`/api/sales-readiness/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      // Best-effort — refetch on next open if it failed
    }
  };

  const addToUpNext = async (item: ReadinessItem) => {
    if (!canEdit) return;
    setPendingItem(item.id);
    try {
      const res = await fetch("/api/coaching/next-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          description: item.description || undefined,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        onAddedAsNextGoal?.({ ...json.goal, tasks: [] });
        setAddedItemIds((prev) => new Set(prev).add(item.id));
      }
    } finally {
      setPendingItem(null);
    }
  };

  const filteredStages = useMemo(() => {
    if (!data) return [];
    return data.stages
      .map((stage) => ({
        ...stage,
        categories: stage.categories
          .map((cat) => ({
            ...cat,
            items: cat.items.filter((i) => statusFilter.has(i.status)),
          }))
          .filter((c) => c.items.length > 0),
      }))
      .filter((s) => s.categories.length > 0);
  }, [data, statusFilter]);

  return (
    <>
      {/* Persistent right-edge rail — visible whenever the tray is closed
          so the founder can pop it open from anywhere on the page, mirroring
          the Deal Chat panel pattern. */}
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          className="fixed right-0 top-1/3 z-30 flex flex-col items-center gap-3 px-3 py-5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 border-r-0 rounded-l-xl shadow-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-200 transition-colors group/rail"
          aria-label="Open GTM Readiness Progression tray"
          title="Open GTM Readiness Progression"
        >
          <span className="text-2xl leading-none" aria-hidden>✅</span>
          <span
            className="text-[11px] font-semibold tracking-wider text-gray-600 dark:text-gray-300 group-hover/rail:text-purple-700 dark:group-hover/rail:text-purple-300 uppercase"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            GTM Readiness
          </span>
          <svg className="w-5 h-5 text-gray-400 group-hover/rail:text-purple-600 dark:group-hover/rail:text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      {/* Tray */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[520px] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 transition-transform duration-200 flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                ✅ GTM Readiness Progression
              </h2>
              <a
                href="/sales-readiness"
                target="_blank"
                rel="noopener noreferrer"
                title="Open full page"
                className="text-[11px] text-purple-600 dark:text-purple-300 hover:underline"
              >
                ↗
              </a>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {canEdit
                ? "Promote items into Up Next, or cycle status inline."
                : "Read-only — open this session to promote items."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Close (Esc)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters + expand/collapse controls */}
        <div className="px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-1.5">
          {STATUS_OPTIONS.map((opt) => {
            const active = statusFilter.has(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => toggleFilter(opt.value)}
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition ${
                  active
                    ? opt.color
                    : "bg-transparent text-gray-400 border border-gray-200 dark:border-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            );
          })}
          {filteredStages.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setExpandedStages(new Set(filteredStages.map((s) => s.key)))}
                className="text-[11px] text-purple-600 dark:text-purple-300 hover:underline font-medium"
                title="Expand every stage"
              >
                Expand all
              </button>
              <span className="text-gray-300">·</span>
              <button
                onClick={() => setExpandedStages(new Set())}
                className="text-[11px] text-gray-500 dark:text-gray-400 hover:underline font-medium"
                title="Collapse every stage"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>

        {/* Body — min-h-0 is required so flex-1 inside a flex-col parent
            can shrink below its content size and let overflow-y-auto
            actually take effect. Without it the body grows to fit every
            stage at once and the scroll is silently dead. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {loading && !data ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : filteredStages.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">
              No items match the current filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStages.map((stage) => {
                const isCurrent = stage.key === data?.currentMaturityStage;
                const expanded = expandedStages.has(stage.key);
                return (
                  <div
                    key={stage.key}
                    className={`border rounded-lg overflow-hidden ${
                      isCurrent
                        ? "border-purple-300 dark:border-purple-700"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <button
                      onClick={() => toggleStage(stage.key)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left ${
                        isCurrent
                          ? "bg-purple-50 dark:bg-purple-900/20"
                          : "bg-gray-50 dark:bg-gray-800/50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          {stage.label}
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wider text-purple-600 dark:text-purple-300 font-bold">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {stage.question}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          {stage.doneCount}/{stage.totalCount}
                        </span>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {expanded && (
                      <div className="p-3 space-y-3 bg-white dark:bg-gray-900">
                        {stage.categories.map((cat) => (
                          <div key={cat.name}>
                            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                              {cat.name}
                            </div>
                            <div className="space-y-1.5">
                              {cat.items.map((item) => {
                                const opt = statusOpt(item.status);
                                const added = addedItemIds.has(item.id);
                                return (
                                  <div
                                    key={item.id}
                                    className="group/item border border-gray-200 dark:border-gray-700 rounded-md p-2.5 hover:border-purple-300 dark:hover:border-purple-700 transition"
                                  >
                                    <div className="flex items-start gap-2">
                                      <button
                                        onClick={() => cycleStatus(item)}
                                        disabled={!canEdit}
                                        title={canEdit ? "Click to cycle status" : opt.label}
                                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${opt.color} ${
                                          canEdit ? "hover:ring-2 hover:ring-purple-300 cursor-pointer" : "cursor-default"
                                        }`}
                                      >
                                        {opt.icon} {opt.label}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                                          {item.title}
                                        </div>
                                        {item.description && (
                                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 group-hover/item:line-clamp-none">
                                            {item.description}
                                          </div>
                                        )}
                                        {(item.notes || item.evidenceUrl) && (
                                          <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800 space-y-1">
                                            {item.notes && (
                                              <div className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 line-clamp-2 group-hover/item:line-clamp-none whitespace-pre-wrap break-words">
                                                {item.notes}
                                              </div>
                                            )}
                                            {item.evidenceUrl && (
                                              /^https?:\/\//.test(item.evidenceUrl) ? (
                                                <a
                                                  href={item.evidenceUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-[11px] text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-1 break-all line-clamp-1 group-hover/item:line-clamp-none"
                                                >
                                                  🔗 {item.evidenceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                                                </a>
                                              ) : (
                                                <div className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-1 group-hover/item:line-clamp-none break-words">
                                                  📎 {item.evidenceUrl}
                                                </div>
                                              )
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {canEdit && (
                                      <div className="flex justify-end mt-1.5">
                                        <button
                                          onClick={() => addToUpNext(item)}
                                          disabled={pendingItem === item.id || added}
                                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full transition ${
                                            added
                                              ? "text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300 cursor-default"
                                              : "text-purple-600 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300"
                                          } disabled:opacity-50`}
                                          title="Add this item to Up Next on the current session"
                                        >
                                          {added ? "✓ Added" : pendingItem === item.id ? "Adding…" : "+ Add to Up Next"}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
