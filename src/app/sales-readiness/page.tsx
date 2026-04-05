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
  mikeyLinks: Array<{ label: string; href: string }> | null;
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
  inProgress: number;
  upNext: number;
  deferred: number;
  notDoing: number;
  toDo: number;
  total: number;
}

const STATUS_OPTIONS = [
  { value: "to_do", label: "To Do", icon: "○", color: "bg-gray-100 text-gray-600" },
  { value: "up_next", label: "Up Next", icon: "⏭", color: "bg-purple-100 text-purple-700" },
  { value: "in_progress", label: "In Progress", icon: "🔨", color: "bg-blue-100 text-blue-700" },
  { value: "done", label: "Done", icon: "✅", color: "bg-green-100 text-green-700" },
  { value: "deferred", label: "Deferred", icon: "⏸", color: "bg-amber-100 text-amber-700" },
  { value: "not_doing", label: "Not Doing", icon: "✗", color: "bg-gray-100 text-gray-400" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "to_do", label: "To Do" },
  { value: "up_next", label: "Up Next" },
  { value: "in_progress", label: "In Progress" },
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
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("all");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingEvidence, setEditingEvidence] = useState<string | null>(null);
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
          // Load saved UI state
          if (data.uiState?.expandedStages) {
            setExpandedStages(new Set(data.uiState.expandedStages));
          } else {
            // First visit — auto-expand current maturity stage
            const expandStage = data.currentMaturityStage || data.stages?.[0]?.key;
            if (expandStage) setExpandedStages(new Set([expandStage]));
          }
          if (data.uiState?.collapsedCategories) {
            setCollapsedCategories(new Set(data.uiState.collapsedCategories));
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

  const saveCollapseState = (stages: Set<string>, categories: Set<string>) => {
    fetch("/api/sales-readiness/ui-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expandedStages: [...stages],
        collapsedCategories: [...categories],
      }),
    }).catch(() => {});
  };

  const toggleStage = (key: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapseState(next, collapsedCategories);
      return next;
    });
  };

  const toggleCategory = (stageKey: string, catName: string) => {
    const catKey = `${stageKey}::${catName}`;
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey);
      else next.add(catKey);
      saveCollapseState(expandedStages, next);
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

  const [askingMikey, setAskingMikey] = useState<string | null>(null);

  const askMikeyAbout = async (item: ReadinessItem, categoryName: string, stageLabel: string) => {
    setAskingMikey(item.id);
    try {
      const mikeyToolsList = item.mikeyLinks?.map((l) => `- ${l.label} (${l.href})`).join("\n") || "";

      const context = `The user is working through their Sales Readiness Checklist and wants to learn about a specific capability they need to build.

## Capability Details
- **Stage:** ${stageLabel}
- **Category:** ${categoryName}
- **Capability:** ${item.title}
${item.description ? `- **Description:** ${item.description}` : ""}
- **Current Status:** ${item.status.replace(/_/g, " ")}
${item.notes ? `- **User's Notes:** ${item.notes}` : ""}
${mikeyToolsList ? `\n## Linked MikeyBot Tools\n${mikeyToolsList}` : ""}

## What the User Needs
Please explain:
1. What "${item.title}" is and why it matters for founder-led sales at the "${stageLabel}" stage
2. What "good" looks like — concrete examples of this capability done well
3. Step-by-step instructions to get this done (actionable, specific)
4. If MikeyBot has tools that can help build this, explain which ones and how to use them — include direct links
5. Reference resources: books, frameworks, articles, or templates that would help (from the Founding Sales / Founder-Led Sales body of knowledge if applicable)
6. Common mistakes founders make with this and how to avoid them`;

      const res = await fetch("/api/conversations/from-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Sales Readiness: ${item.title}`,
          context,
          autoSend: true,
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        // Store context in sessionStorage for the chat page to pick up
        sessionStorage.setItem(`autoSend-${data.conversationId}`, context);
        window.open(`/chat/${data.conversationId}?autoSend=true`, "_blank");
      }
    } catch (error) {
      console.error("Failed to create chat:", error);
    } finally {
      setAskingMikey(null);
    }
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
                {overall.inProgress > 0 && <span className="text-blue-600">{overall.inProgress} in progress</span>}
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
                      {filteredCategories.map((cat) => {
                        const catKey = `${stage.key}::${cat.name}`;
                        const isCatCollapsed = collapsedCategories.has(catKey);
                        return (
                        <div key={cat.name} className="border-b border-gray-50 last:border-b-0">
                          {/* Category header — clickable to collapse */}
                          <button
                            onClick={() => toggleCategory(stage.key, cat.name)}
                            className="w-full px-5 py-2.5 bg-gray-50/50 flex items-center gap-3 hover:bg-gray-100/50 transition-colors text-left"
                          >
                            <div className="w-24 flex-shrink-0 flex items-center">
                              <svg className={`w-3 h-3 text-gray-400 transition-transform ${isCatCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                            <span className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{cat.name}</span>
                            {!isCatCollapsed && <span className="w-32 flex-shrink-0 text-xs text-gray-400 font-medium">MikeyBot</span>}
                            {!isCatCollapsed && <span className="w-48 flex-shrink-0 text-xs text-gray-400 font-medium">Evidence / Asset</span>}
                            <span className="text-xs text-gray-400">{cat.doneCount}/{cat.totalCount}</span>
                          </button>

                          {/* Items — collapsible */}
                          {!isCatCollapsed && cat.items.map((item) => {
                            const statusOpt = getStatusOption(item.status);
                            const notesValue = noteValues[item.id] ?? item.notes ?? "";
                            return (
                              <div key={item.id} id={`readiness-${item.id}`} className="px-5 py-3 border-t border-gray-100 first:border-t-0 group">
                                <div className="flex items-start gap-3">
                                  {/* Status dropdown — left */}
                                  <select
                                    value={item.status}
                                    onChange={(e) => updateItemStatus(item.id, e.target.value)}
                                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer flex-shrink-0 mt-0.5 ${statusOpt.color}`}
                                  >
                                    {STATUS_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                                    ))}
                                  </select>

                                  {/* Title + notes — center */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm ${item.status === "done" ? "text-gray-900 font-medium" : item.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700"}`}>
                                        {item.title}
                                      </span>
                                      <button
                                        onClick={() => askMikeyAbout(item, cat.name, stage.label)}
                                        disabled={askingMikey === item.id}
                                        className="flex-shrink-0 text-[11px] text-purple-500 hover:text-purple-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                        title="Ask Mikey about this capability"
                                      >
                                        {askingMikey === item.id ? "..." : "💬 Ask Mikey"}
                                      </button>
                                    </div>
                                    {item.description && (
                                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                                    )}
                                    {item.status !== "to_do" && item.statusChangedAt && (
                                      <p className="text-[11px] text-gray-400 mt-1">
                                        {statusOpt.label} {formatDate(item.statusChangedAt)}
                                        {item.statusChangedByName && ` by ${item.statusChangedByName}`}
                                      </p>
                                    )}
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
                                  </div>

                                  {/* MikeyBot links column */}
                                  <div className="flex-shrink-0 w-32">
                                    {item.mikeyLinks && item.mikeyLinks.length > 0 && (
                                      <div className="flex flex-col gap-0.5">
                                        {item.mikeyLinks.map((link, i) => (
                                          <a
                                            key={i}
                                            href={link.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-purple-600 hover:text-purple-700 font-medium truncate block"
                                          >
                                            → {link.label}
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Evidence / Asset — right column */}
                                  <div className="flex-shrink-0 w-48">
                                    {editingEvidence === item.id ? (
                                      <input
                                        type="text"
                                        defaultValue={item.evidenceUrl || ""}
                                        onBlur={(e) => {
                                          const val = e.target.value.trim();
                                          updateItemEvidenceUrl(item.id, val);
                                          setEditingEvidence(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                          if (e.key === "Escape") setEditingEvidence(null);
                                        }}
                                        placeholder="URL, doc name, notes..."
                                        autoFocus
                                        className="w-full text-xs px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                    ) : item.evidenceUrl ? (
                                      <div className="flex items-center gap-1.5">
                                        {/^https?:\/\//.test(item.evidenceUrl) ? (
                                          <>
                                            <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                            <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-700 truncate">{item.evidenceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a>
                                          </>
                                        ) : (
                                          <span className="text-xs text-gray-600 truncate">{item.evidenceUrl}</span>
                                        )}
                                        <button onClick={() => setEditingEvidence(item.id)} className="text-xs text-gray-400 hover:text-blue-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Edit">✎</button>
                                        <button onClick={() => updateItemEvidenceUrl(item.id, "")} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">✕</button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setEditingEvidence(item.id)}
                                        className="text-xs text-gray-400 hover:text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        + Evidence / Asset
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        );
                      })}
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
