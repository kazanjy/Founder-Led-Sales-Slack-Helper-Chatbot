"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";

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
}

interface Category {
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

interface OverallStats {
  done: number;
  upNext: number;
  deferred: number;
  notDoing: number;
  toDo: number;
  total: number;
}

const STATUS_OPTIONS = [
  { value: "to_do", label: "To Do", icon: "○", color: "bg-gray-100 text-gray-600" },
  { value: "up_next", label: "Up Next", icon: "⏭", color: "bg-purple-100 text-purple-700" },
  { value: "done", label: "Done", icon: "✅", color: "bg-green-100 text-green-700" },
  { value: "deferred", label: "Deferred", icon: "⏸", color: "bg-amber-100 text-amber-700" },
  { value: "not_doing", label: "Not Doing", icon: "✗", color: "bg-gray-100 text-gray-400" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "to_do", label: "To Do" },
  { value: "up_next", label: "Up Next" },
  { value: "done", label: "Done" },
  { value: "deferred", label: "Deferred" },
  { value: "not_doing", label: "Not Doing" },
];

function getStatusOption(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SalesReadinessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <SalesReadinessContent />
    </Suspense>
  );
}

function SalesReadinessContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [currentMaturityStage, setCurrentMaturityStage] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("all");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState<Record<string, string>>({});
  const noteSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    document.title = "Sales Readiness - Mikey";
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        const res = await fetch("/api/sales-readiness");
        if (res.ok) {
          const data = await res.json();
          setStages(data.stages || []);
          setOverall(data.overall || null);
          setCurrentMaturityStage(data.currentMaturityStage || null);
          // Auto-expand current maturity stage, or first stage with items
          const expandStage = data.currentMaturityStage || data.stages?.[0]?.key;
          if (expandStage) {
            setExpandedStages(new Set([expandStage]));
          }
        }
      } catch (error) {
        console.error("Error loading readiness data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  const toggleStage = (key: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateItemStatus = async (itemId: string, status: string) => {
    // Optimistic update
    setStages((prev) => prev.map((stage) => ({
      ...stage,
      categories: stage.categories.map((cat) => ({
        ...cat,
        items: cat.items.map((item) =>
          item.id === itemId ? { ...item, status, statusChangedAt: new Date().toISOString(), completedAt: status === "done" ? new Date().toISOString() : null } : item
        ),
        doneCount: cat.items.filter((i) => (i.id === itemId ? status : i.status) === "done").length,
      })),
      doneCount: stage.categories.flatMap((c) => c.items).filter((i) => (i.id === itemId ? status : i.status) === "done").length,
    })));

    // Update overall stats
    setOverall((prev) => {
      if (!prev) return prev;
      const allItems = stages.flatMap((s) => s.categories.flatMap((c) => c.items));
      const oldItem = allItems.find((i) => i.id === itemId);
      if (!oldItem) return prev;
      const stats = { ...prev };
      // Decrement old status
      const oldKey = oldItem.status === "to_do" ? "toDo" : oldItem.status === "up_next" ? "upNext" : oldItem.status === "not_doing" ? "notDoing" : oldItem.status as keyof OverallStats;
      if (oldKey in stats) (stats[oldKey] as number)--;
      // Increment new status
      const newKey = status === "to_do" ? "toDo" : status === "up_next" ? "upNext" : status === "not_doing" ? "notDoing" : status as keyof OverallStats;
      if (newKey in stats) (stats[newKey] as number)++;
      return stats;
    });

    await fetch(`/api/sales-readiness/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const updateItemNotes = (itemId: string, notes: string) => {
    setNoteValues((prev) => ({ ...prev, [itemId]: notes }));
    // Optimistic update
    setStages((prev) => prev.map((stage) => ({
      ...stage,
      categories: stage.categories.map((cat) => ({
        ...cat,
        items: cat.items.map((item) => item.id === itemId ? { ...item, notes } : item),
      })),
    })));
    // Debounced save
    if (noteSaveTimers.current[itemId]) clearTimeout(noteSaveTimers.current[itemId]);
    noteSaveTimers.current[itemId] = setTimeout(async () => {
      await fetch(`/api/sales-readiness/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      delete noteSaveTimers.current[itemId];
    }, 1500);
  };

  const updateItemEvidenceUrl = (itemId: string, evidenceUrl: string) => {
    setStages((prev) => prev.map((stage) => ({
      ...stage,
      categories: stage.categories.map((cat) => ({
        ...cat,
        items: cat.items.map((item) => item.id === itemId ? { ...item, evidenceUrl } : item),
      })),
    })));
    const key = `evidence-${itemId}`;
    if (noteSaveTimers.current[key]) clearTimeout(noteSaveTimers.current[key]);
    noteSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/sales-readiness/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceUrl }),
      });
      delete noteSaveTimers.current[key];
    }, 1500);
  };

  // Cleanup timers
  useEffect(() => {
    const timers = noteSaveTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <svg className="animate-spin h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </div>
    );
  }

  const progressPercent = overall ? Math.round((overall.done / Math.max(overall.total, 1)) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Readiness Checklist</h1>
          <p className="text-gray-500 text-sm">Track your sales capabilities and assets across each maturity stage.</p>
        </div>

        {/* Overall Progress */}
        {overall && overall.total > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <span className="font-semibold text-gray-900">{overall.done}/{overall.total} done</span>
                {overall.upNext > 0 && <span className="text-purple-600">{overall.upNext} up next</span>}
                {overall.deferred > 0 && <span className="text-amber-600">{overall.deferred} deferred</span>}
                {overall.notDoing > 0 && <span className="text-gray-400">{overall.notDoing} not doing</span>}
              </div>
              <span className="text-sm font-semibold text-gray-900">{progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-green-500 h-2.5 rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === f.value
                  ? "bg-purple-100 text-purple-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Stages */}
        {stages.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No checklist items yet</h3>
            <p className="text-gray-500">Ask your admin to seed the Sales Readiness checklist items.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {stages.map((stage) => {
              const isExpanded = expandedStages.has(stage.key);
              const isCurrent = stage.key === currentMaturityStage;

              // Filter items
              const filteredCategories = stage.categories.map((cat) => ({
                ...cat,
                items: filter === "all" ? cat.items : cat.items.filter((i) => i.status === filter),
              })).filter((cat) => cat.items.length > 0);

              if (filter !== "all" && filteredCategories.length === 0) return null;

              return (
                <div key={stage.key} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isCurrent ? "border-purple-300 ring-1 ring-purple-100" : "border-gray-200"}`}>
                  {/* Stage header */}
                  <button
                    onClick={() => toggleStage(stage.key)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{stage.label}</span>
                          {isCurrent && (
                            <span className="text-[10px] font-medium bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Current Stage</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{stage.question}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-sm font-medium ${stage.doneCount === stage.totalCount && stage.totalCount > 0 ? "text-green-600" : "text-gray-500"}`}>
                        {stage.doneCount}/{stage.totalCount}
                      </span>
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${stage.totalCount > 0 ? (stage.doneCount / stage.totalCount) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </button>

                  {/* Stage content */}
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {filteredCategories.map((cat) => (
                        <div key={cat.name} className="border-b border-gray-50 last:border-b-0">
                          {/* Category header */}
                          <div className="px-5 py-2.5 bg-gray-50/50 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{cat.name}</span>
                            <span className="text-xs text-gray-400">{cat.doneCount}/{cat.totalCount}</span>
                          </div>

                          {/* Items */}
                          {cat.items.map((item) => {
                            const statusOpt = getStatusOption(item.status);
                            const notesValue = noteValues[item.id] ?? item.notes ?? "";
                            return (
                              <div key={item.id} id={`readiness-${item.id}`} className="px-5 py-3 border-t border-gray-100 first:border-t-0 group">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm ${item.status === "done" ? "text-gray-900 font-medium" : item.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700"}`}>
                                        {item.title}
                                      </span>
                                    </div>
                                    {item.description && (
                                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                                    )}
                                    {/* Status attribution */}
                                    {item.status !== "to_do" && item.statusChangedAt && (
                                      <p className="text-[11px] text-gray-400 mt-1">
                                        {statusOpt.label} {formatDate(item.statusChangedAt)}
                                        {item.statusChangedByName && ` by ${item.statusChangedByName}`}
                                      </p>
                                    )}
                                    {/* Notes */}
                                    {editingNotes === item.id ? (
                                      <textarea
                                        value={notesValue}
                                        onChange={(e) => updateItemNotes(item.id, e.target.value)}
                                        onBlur={() => setEditingNotes(null)}
                                        placeholder="Add notes, proof, links..."
                                        rows={2}
                                        autoFocus
                                        className="mt-2 w-full px-3 py-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg resize-y focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                      />
                                    ) : notesValue ? (
                                      <div
                                        onClick={() => setEditingNotes(item.id)}
                                        className="mt-1.5 text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 cursor-text hover:bg-gray-100 transition-colors whitespace-pre-wrap"
                                      >
                                        {notesValue}
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setEditingNotes(item.id)}
                                        className="mt-1 text-xs text-purple-500 hover:text-purple-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        + Add notes
                                      </button>
                                    )}
                                    {/* Evidence URL */}
                                    {item.evidenceUrl ? (
                                      <div className="mt-1.5 flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                        <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-700 truncate max-w-xs">{item.evidenceUrl}</a>
                                        <button onClick={() => updateItemEvidenceUrl(item.id, "")} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0">✕</button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          const url = prompt("Paste a link to the evidence / asset:");
                                          if (url?.trim()) updateItemEvidenceUrl(item.id, url.trim());
                                        }}
                                        className="mt-1 text-xs text-blue-500 hover:text-blue-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        🔗 Add evidence / asset link
                                      </button>
                                    )}
                                  </div>
                                  {/* Status dropdown */}
                                  <select
                                    value={item.status}
                                    onChange={(e) => updateItemStatus(item.id, e.target.value)}
                                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer flex-shrink-0 ${statusOpt.color}`}
                                  >
                                    {STATUS_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            );
                          })}
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
    </div>
  );
}
