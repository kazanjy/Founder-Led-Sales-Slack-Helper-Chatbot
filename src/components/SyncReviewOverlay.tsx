"use client";

import { useState } from "react";

interface SupportingExcerpt {
  source: string;
  text: string;
}

interface ProposedChange {
  itemId: string;
  itemTitle: string;
  capabilityCategory: string;
  maturityStage: string;
  currentStatus: string;
  proposedStatus: string;
  confidence: "high" | "medium" | "low";
  evidenceText: string;
  supportingExcerpts: SupportingExcerpt[];
  reasoning: string;
}

interface RecommendedStage {
  stage: string;
  reasoning: string;
}

interface SyncReviewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  source: "assessment" | "coaching";
  proposedChanges: ProposedChange[];
  recommendedStage: RecommendedStage | null;
  onApply: (selectedItemIds: string[], acceptStage: boolean, statusOverrides: Record<string, string>, stageOverride?: string) => Promise<void>;
}

const STAGE_LABELS: Record<string, string> = {
  PROBLEM_VALIDATION: "🔍 Problem Validation",
  VALUE_VALIDATION: "💡 Value Validation",
  FIRST_REVENUE: "💰 First Revenue",
  REPEATABLE_REVENUE: "🔄 Repeatable Revenue",
  FIRST_SALES_HIRE: "👤 First Sales Hire",
  SCALING_SALES: "📈 Scaling Sales",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  to_do: { label: "To Do", color: "bg-slate-200 text-slate-700" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700" },
  done: { label: "Done", color: "bg-green-100 text-green-700" },
  up_next: { label: "Up Next", color: "bg-purple-100 text-purple-700" },
  deferred: { label: "Deferred", color: "bg-amber-100 text-amber-700" },
  not_doing: { label: "Not Doing", color: "bg-gray-100 text-gray-400" },
};

const CONFIDENCE_STYLES: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "bg-green-100 text-green-700" },
  medium: { label: "Med", color: "bg-amber-100 text-amber-700" },
  low: { label: "Low", color: "bg-red-100 text-red-600" },
};

export default function SyncReviewOverlay({
  isOpen,
  onClose,
  source,
  proposedChanges,
  recommendedStage,
  onApply,
}: SyncReviewOverlayProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // Default: check high and medium confidence, uncheck low
    const initial = new Set<string>();
    for (const change of proposedChanges) {
      if (change.confidence !== "low") {
        initial.add(change.itemId);
      }
    }
    return initial;
  });
  const [acceptStage, setAcceptStage] = useState(true);
  const [stageOverride, setStageOverride] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const toggleItem = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(proposedChanges.map((c) => c.itemId)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply([...selectedIds], acceptStage, statusOverrides, stageOverride || undefined);
    } finally {
      setApplying(false);
    }
  };

  // Group changes by maturity stage
  const stageOrder = ["PROBLEM_VALIDATION", "VALUE_VALIDATION", "FIRST_REVENUE", "REPEATABLE_REVENUE", "FIRST_SALES_HIRE", "SCALING_SALES"];
  const groupedByStage = new Map<string, ProposedChange[]>();
  for (const change of proposedChanges) {
    if (!groupedByStage.has(change.maturityStage)) {
      groupedByStage.set(change.maturityStage, []);
    }
    groupedByStage.get(change.maturityStage)!.push(change);
  }

  const selectedCount = selectedIds.size;
  const sourceLabel = source === "assessment" ? "GTM Maturity Assessment" : "Coaching Sessions";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Sync from {sourceLabel}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {proposedChanges.length} proposed update{proposedChanges.length !== 1 ? "s" : ""} found. Review and select which to apply.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Recommended Stage */}
          {recommendedStage && (
            <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-purple-900">Stage:</span>
                      <select
                        value={stageOverride || recommendedStage.stage}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStageOverride(val === recommendedStage.stage ? null : val);
                        }}
                        className={`text-sm font-semibold text-purple-900 bg-white dark:bg-gray-800 border border-purple-300 rounded-lg px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500 ${stageOverride ? "ring-2 ring-purple-400" : ""}`}
                      >
                        {stageOrder.map((key) => (
                          <option key={key} value={key}>{STAGE_LABELS[key] || key}</option>
                        ))}
                      </select>
                      {stageOverride && (
                        <span className="text-xs text-purple-500 italic">
                          (suggested: {STAGE_LABELS[recommendedStage.stage] || recommendedStage.stage})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-purple-700 mt-1">{recommendedStage.reasoning}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={acceptStage}
                    onChange={(e) => setAcceptStage(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-gray-300 dark:border-gray-700 focus:ring-purple-500"
                  />
                  <span className="text-sm text-purple-700 font-medium">Apply</span>
                </label>
              </div>
            </div>
          )}

          {/* Selection controls */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={selectAll} className="text-sm text-purple-600 hover:text-purple-800 hover:underline">
                Select all
              </button>
              <span className="text-gray-300">|</span>
              <button onClick={selectNone} className="text-sm text-purple-600 hover:text-purple-800 hover:underline">
                Select none
              </button>
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {selectedCount} of {proposedChanges.length} selected
            </span>
          </div>

          {/* Proposed changes grouped by stage */}
          {stageOrder.filter((s) => groupedByStage.has(s)).map((stageKey) => {
            const changes = groupedByStage.get(stageKey)!;
            return (
              <div key={stageKey} className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  {STAGE_LABELS[stageKey] || stageKey}
                </h3>
                <div className="space-y-2">
                  {changes.map((change) => {
                    const isSelected = selectedIds.has(change.itemId);
                    const conf = CONFIDENCE_STYLES[change.confidence] || CONFIDENCE_STYLES.medium;
                    const currentSt = STATUS_LABELS[change.currentStatus] || STATUS_LABELS.to_do;
                    const proposedSt = STATUS_LABELS[change.proposedStatus] || STATUS_LABELS.to_do;

                    return (
                      <div
                        key={change.itemId}
                        className={`border rounded-xl transition-colors ${
                          isSelected ? "border-purple-300 bg-purple-50/30" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                        }`}
                      >
                        {/* Header row — title, status flow, confidence */}
                        <div className="flex items-center gap-3 px-4 py-3 select-none">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleItem(change.itemId)}
                            className="w-4 h-4 text-purple-600 rounded border-gray-300 dark:border-gray-700 focus:ring-purple-500 flex-shrink-0"
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{change.itemTitle}</span>
                              <span className="text-xs text-gray-400">{change.capabilityCategory}</span>
                            </div>
                          </div>

                          {/* Status change badge */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${currentSt.color}`}>
                              {currentSt.label}
                            </span>
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <select
                              value={statusOverrides[change.itemId] || change.proposedStatus}
                              onChange={(e) => {
                                const val = e.target.value;
                                setStatusOverrides((prev) => {
                                  if (val === change.proposedStatus) {
                                    const next = { ...prev };
                                    delete next[change.itemId];
                                    return next;
                                  }
                                  return { ...prev, [change.itemId]: val };
                                });
                              }}
                              className={`px-2 py-0.5 rounded-full text-xs font-medium border-none cursor-pointer appearance-none pr-5 bg-no-repeat bg-[length:12px] bg-[right_4px_center] ${
                                (STATUS_LABELS[statusOverrides[change.itemId] || change.proposedStatus] || proposedSt).color
                              } ${statusOverrides[change.itemId] ? "ring-2 ring-purple-400 ring-offset-1" : ""}`}
                              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")` }}
                            >
                              {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Confidence badge */}
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${conf.color}`}>
                            {conf.label}
                          </span>
                        </div>

                        {/* Always-visible side-by-side: proposed evidence
                            (with reasoning underneath) on the left and the
                            supporting source excerpts on the right. The
                            click-to-expand gate was removed so the user
                            can scan proof for every proposed change without
                            playing chevron whack-a-mole. */}
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 ml-7">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Left: proposed evidence */}
                              <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Proposed Evidence</p>
                                <p className="text-sm text-gray-700 dark:text-gray-200">{change.evidenceText}</p>
                                <p className="text-xs text-gray-400 mt-2 italic">{change.reasoning}</p>
                              </div>

                              {/* Right: supporting excerpts */}
                              <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Supporting Material</p>
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                  {change.supportingExcerpts.map((excerpt, i) => (
                                    <div key={i} className="bg-gray-50 rounded-lg p-2.5">
                                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">{excerpt.source}</p>
                                      <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{excerpt.text}</p>
                                    </div>
                                  ))}
                                  {change.supportingExcerpts.length === 0 && (
                                    <p className="text-xs text-gray-400 italic">No excerpts available</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {proposedChanges.length === 0 && (
            <div className="text-center py-12">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium">No updates found</p>
              <p className="text-sm text-gray-400 mt-1">Your readiness progression is already up to date with your {sourceLabel.toLowerCase()}.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying || (selectedCount === 0 && !acceptStage)}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium text-sm shadow-md hover:shadow-lg flex items-center gap-2"
          >
            {applying ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Applying...
              </>
            ) : (
              <>
                Apply {selectedCount} Change{selectedCount !== 1 ? "s" : ""}
                {acceptStage && recommendedStage ? " + Stage" : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
