"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import SyncReviewOverlay from "@/components/SyncReviewOverlay";

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
  { value: "to_do", label: "To Do", icon: "○", color: "bg-slate-200 text-slate-700 border border-slate-300" },
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

const MATURITY_STAGES = [
  { value: "PROBLEM_VALIDATION", label: "Do we know what problem we're solving?", short: "🔍 Problem Validation" },
  { value: "VALUE_VALIDATION", label: "Does the product solve the problem and create value?", short: "💡 Value Validation" },
  { value: "FIRST_REVENUE", label: "Can we get someone to pay for the product?", short: "💰 First Revenue" },
  { value: "REPEATABLE_REVENUE", label: "Can we get many people to pay for the product?", short: "🔄 Repeatable Revenue" },
  { value: "FIRST_SALES_HIRE", label: "Can we get someone other than the founder to sell?", short: "👤 First Sales Hire" },
  { value: "SCALING_SALES", label: "Can we get many people other than the founder to sell?", short: "📈 Scaling Sales" },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
  const [searchSelectedIdx, setSearchSelectedIdx] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const [noteValues, setNoteValues] = useState<Record<string, string>>({});
  const noteSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const [whatNextLoading, setWhatNextLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [syncData, setSyncData] = useState<any>(null);
  const [syncSource, setSyncSource] = useState<"assessment" | "coaching">("assessment");
  const [showSyncPicker, setShowSyncPicker] = useState(false);
  const [syncSources, setSyncSources] = useState<{
    assessment: { available: boolean; date?: string; title?: string };
    coaching: { available: boolean; date?: string; title?: string; sessionCount?: number };
  } | null>(null);
  const syncPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "GTM Readiness Progression - Mikey";
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

        // Fetch sync sources in parallel (non-blocking)
        fetch("/api/sales-readiness/sync-sources")
          .then((r) => r.ok ? r.json() : null)
          .then((d) => { if (d) setSyncSources(d); })
          .catch(() => {});
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
${mikeyToolsList ? `\n## Linked MikeyBot Tools (CONFIRMED — these are purpose-built for this)\n${mikeyToolsList}\nONLY mention these specific tools. Do NOT speculate about other MikeyBot tools that might exist.` : "\nIMPORTANT: Do NOT speculate about MikeyBot tools that might help. Only mention MikeyBot tools if they are explicitly listed above under 'Linked MikeyBot Tools'. If none are listed, do not suggest any."}

## What the User Needs
Please explain:
1. What "${item.title}" is and why it matters for founder-led sales at the "${stageLabel}" stage
2. What "good" looks like — concrete examples of this capability done well
3. Step-by-step instructions to get this done (actionable, specific)
${mikeyToolsList ? `4. The MikeyBot tools listed above are purpose-built to help with this — explain how to use them and include the direct links` : "4. Skip MikeyBot tool suggestions — there are no tools specifically built for this capability"}
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

  // Search results — computed from all stages/categories/items
  interface SearchResult {
    itemId: string;
    title: string;
    stageKey: string;
    stageLabel: string;
    categoryName: string;
    status: string;
  }

  const searchResults: SearchResult[] = (() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: SearchResult[] = [];
    for (const stage of stages) {
      for (const cat of stage.categories) {
        for (const item of cat.items) {
          if (
            item.title.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q) ||
            stage.label.toLowerCase().includes(q)
          ) {
            results.push({
              itemId: item.id,
              title: item.title,
              stageKey: stage.key,
              stageLabel: stage.label,
              categoryName: cat.name,
              status: item.status,
            });
          }
        }
      }
    }
    return results.slice(0, 15); // cap at 15 results
  })();

  const jumpToItem = (result: SearchResult) => {
    // Expand the parent stage
    setExpandedStages((prev) => {
      const next = new Set(prev);
      next.add(result.stageKey);
      return next;
    });
    // Uncollapse the parent category
    const catKey = `${result.stageKey}::${result.categoryName}`;
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      next.delete(catKey);
      return next;
    });
    // Clear search
    setSearchQuery("");
    setSearchFocused(false);
    // Highlight and scroll after a tick (to let the DOM expand)
    setHighlightedItem(result.itemId);
    setTimeout(() => {
      const el = document.getElementById(`readiness-${result.itemId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-purple-400", "ring-offset-1");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-purple-400", "ring-offset-1");
          setHighlightedItem(null);
        }, 3000);
      }
    }, 150);
  };

  // Close search on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    if (searchFocused) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [searchFocused]);

  // ── Sync functions ──────────────────────────────────────

  const handleSyncFromSource = async (source: "assessment" | "coaching") => {
    setShowSyncPicker(false);
    setSyncSource(source);
    setSyncLoading(true);
    try {
      const res = await fetch("/api/sales-readiness/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncData(data);
        setShowSyncOverlay(true);
      } else {
        console.error("Sync failed:", data.error);
      }
    } catch (error) {
      console.error("Error syncing:", error);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleApplySync = async (selectedItemIds: string[], acceptStage: boolean) => {
    if (!syncData) return;

    const changes = syncData.proposedChanges.filter((c: { itemId: string }) =>
      selectedItemIds.includes(c.itemId)
    );

    await Promise.all(
      changes.map((change: { itemId: string; proposedStatus: string; evidenceText: string }) =>
        fetch(`/api/sales-readiness/${change.itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: change.proposedStatus,
            evidenceUrl: change.evidenceText,
          }),
        })
      )
    );

    if (acceptStage && syncData.recommendedStage) {
      await fetch("/api/coaching/maturity-stage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStage: syncData.recommendedStage.stage }),
      });
    }

    setShowSyncOverlay(false);
    setSyncData(null);

    // Reload the page data
    setLoading(true);
    try {
      const res = await fetch("/api/sales-readiness");
      if (res.ok) {
        const data = await res.json();
        setStages(data.stages);
        setOverall(data.overall);
        setCurrentMaturityStage(data.currentMaturityStage || null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleWhatNext = async () => {
    setWhatNextLoading(true);
    try {
      // Build readiness state context from current stages data
      let context = "## Current GTM Readiness Progression State\n\n";

      if (currentMaturityStage) {
        const stageInfo = MATURITY_STAGES.find((s) => s.value === currentMaturityStage);
        context += `**Current Maturity Stage:** ${stageInfo?.short || currentMaturityStage}\n\n`;
      }

      if (overall) {
        context += `**Overall Progress:** ${overall.done}/${overall.total} done, ${overall.inProgress} in progress, ${overall.upNext} up next, ${overall.toDo} to do\n\n`;
      }

      for (const stage of stages) {
        context += `### ${stage.label}\n`;
        context += `${stage.doneCount}/${stage.totalCount} complete\n\n`;

        for (const cat of stage.categories) {
          const nonTodoItems = cat.items.filter((i) => i.status !== "to_do");
          if (nonTodoItems.length > 0) {
            context += `**${cat.name}** (${cat.doneCount}/${cat.totalCount})\n`;
            for (const item of nonTodoItems) {
              const statusLabel = STATUS_OPTIONS.find((s) => s.value === item.status)?.label || item.status;
              context += `- [${statusLabel}] ${item.title}`;
              if (item.evidenceUrl) context += ` — Evidence: ${item.evidenceUrl}`;
              if (item.notes) context += ` — Notes: ${item.notes}`;
              context += "\n";
            }
            context += "\n";
          } else {
            context += `**${cat.name}** (${cat.doneCount}/${cat.totalCount}) — all to do\n\n`;
          }
        }
      }

      // Fetch last 3 coaching sessions (without transcripts)
      try {
        const sessionsRes = await fetch("/api/coaching-sessions");
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json();
          const recentSessions = (sessionsData.sessions || []).slice(0, 3);

          if (recentSessions.length > 0) {
            context += "\n---\n\n## Recent Coaching Sessions\n\n";

            for (const session of recentSessions) {
              // Fetch enriched data (goals, tasks) for each session
              try {
                const enrichedRes = await fetch(`/api/coaching-sessions/${session.id}`);
                if (enrichedRes.ok) {
                  const enriched = await enrichedRes.json();
                  const sessionDate = new Date(session.sessionDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

                  context += `### ${session.title} (${sessionDate})\n\n`;

                  if (session.notes) {
                    const notesTruncated = session.notes.length > 2000
                      ? session.notes.substring(0, 2000) + "...[truncated]"
                      : session.notes;
                    context += `**Notes:**\n${notesTruncated}\n\n`;
                  }

                  if (enriched.goals?.length > 0) {
                    context += "**Goals:**\n";
                    for (const goal of enriched.goals) {
                      context += `- [${goal.status.toUpperCase()}] ${goal.title}`;
                      if (goal.description) context += `: ${goal.description}`;
                      context += "\n";
                      if (goal.tasks) {
                        for (const task of goal.tasks) {
                          context += `  - [${task.status.toUpperCase()}] ${task.title}\n`;
                        }
                      }
                    }
                    context += "\n";
                  }
                }
              } catch { /* skip this session */ }
            }
          }
        }
      } catch { /* no coaching data */ }

      context += "\n---\n\n## Your Request\n\n";
      context += "Based on my current GTM Readiness Progression state and recent coaching sessions above, what should I focus on next? ";
      context += "Please recommend the top 3-5 specific actions I should take, considering:\n";
      context += "1. What capabilities I'm missing or have in progress at my current maturity stage\n";
      context += "2. What my coaching goals and tasks suggest I should prioritize\n";
      context += "3. What would have the highest impact on moving to the next maturity stage\n\n";
      context += "For each recommendation, explain WHY it matters and link it to specific readiness items or coaching goals.";

      // Create conversation and open chat
      const res = await fetch("/api/conversations/from-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "What Next? — GTM Readiness Recommendations",
          context,
          autoSend: true,
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        window.open(`/chat/${data.conversationId}?autoSend=true`, "_blank");
      }
    } catch (error) {
      console.error("Error creating What Next chat:", error);
    } finally {
      setWhatNextLoading(false);
    }
  };

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">GTM Readiness Progression</h1>
            <p className="text-gray-500 text-sm">Track your go-to-market capabilities and assets across each maturity stage.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* What Next? button */}
            <button
              onClick={handleWhatNext}
              disabled={whatNextLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50"
            >
              {whatNextLoading ? (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              What Next?
            </button>

            {/* Sync Readiness dropdown */}
            <div
              className="relative"
              ref={syncPickerRef}
              onMouseEnter={() => !syncLoading && setShowSyncPicker(true)}
              onMouseLeave={() => setShowSyncPicker(false)}
            >
            <button
              disabled={syncLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors font-medium text-sm disabled:opacity-50 border border-purple-200"
            >
              {syncLoading ? (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {syncLoading ? "Analyzing..." : "Sync Readiness"}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSyncPicker && (
              <div className="absolute right-0 top-full pt-1 w-80 z-50">
              <div className="bg-white border border-gray-200 rounded-xl shadow-lg py-2">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sync from...</p>
                </div>

                {/* Assessment source */}
                <button
                  onClick={() => handleSyncFromSource("assessment")}
                  disabled={!syncSources?.assessment?.available}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-purple-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">GTM Maturity Assessment</p>
                    {syncSources?.assessment?.available ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Completed {new Date(syncSources.assessment.date!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">No completed assessment yet</p>
                    )}
                  </div>
                </button>

                {/* Coaching source */}
                <button
                  onClick={() => handleSyncFromSource("coaching")}
                  disabled={!syncSources?.coaching?.available}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-purple-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">Coaching Sessions</p>
                    {syncSources?.coaching?.available ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {syncSources.coaching.sessionCount} session{syncSources.coaching.sessionCount !== 1 ? "s" : ""} — latest {new Date(syncSources.coaching.date!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">No coaching sessions yet</p>
                    )}
                  </div>
                </button>
              </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Maturity Stage Selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 flex-shrink-0">Current Stage:</label>
            <select
              value={currentMaturityStage || ""}
              onChange={async (e) => {
                const stage = e.target.value;
                setCurrentMaturityStage(stage || null);
                await fetch("/api/coaching/maturity-stage", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ currentStage: stage }),
                });
                // Auto-expand the selected stage
                if (stage) {
                  setExpandedStages((prev) => {
                    const next = new Set(prev);
                    next.add(stage);
                    return next;
                  });
                }
              }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
            >
              <option value="">Select your current stage...</option>
              {MATURITY_STAGES.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.short} — {stage.label}
                </option>
              ))}
            </select>
          </div>
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

        {/* Search */}
        <div className="relative mb-4" ref={searchRef}>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchSelectedIdx(0); }}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchQuery(""); setSearchFocused(false); }
                if (e.key === "ArrowDown") { e.preventDefault(); setSearchSelectedIdx((i) => Math.min(i + 1, searchResults.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSearchSelectedIdx((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && searchResults[searchSelectedIdx]) { e.preventDefault(); jumpToItem(searchResults[searchSelectedIdx]); }
              }}
              placeholder="Search capabilities..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setSearchFocused(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {searchFocused && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
              {searchResults.map((result, idx) => {
                const statusOpt = getStatusOption(result.status);
                return (
                  <button
                    key={result.itemId}
                    onClick={() => jumpToItem(result)}
                    onMouseEnter={() => setSearchSelectedIdx(idx)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${idx === searchSelectedIdx ? "bg-purple-50" : "hover:bg-gray-50"} ${idx > 0 ? "border-t border-gray-50" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">{result.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{result.stageLabel} → {result.categoryName}</div>
                    </div>
                    <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${statusOpt.color}`}>
                      {statusOpt.icon} {statusOpt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {searchFocused && searchQuery.trim() && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4 text-center text-sm text-gray-400">
              No capabilities matching &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </div>

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
          <div className="space-y-3">
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
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-semibold text-gray-900">{stage.label}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-medium bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full flex-shrink-0">Current</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-sm font-semibold ${stage.doneCount === stage.totalCount && stage.totalCount > 0 ? "text-green-600" : "text-gray-400"}`}>
                        {stage.doneCount}/{stage.totalCount}
                      </span>
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${stage.totalCount > 0 ? (stage.doneCount / stage.totalCount) * 100 : 0}%` }} />
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
                        <div key={cat.name}>
                          {/* Category header */}
                          <button
                            onClick={() => toggleCategory(stage.key, cat.name)}
                            className="w-full px-4 py-2 bg-gray-50 border-y border-gray-100 flex items-center gap-2 hover:bg-gray-100/70 transition-colors text-left"
                          >
                            <svg className={`w-2.5 h-2.5 text-gray-400 transition-transform ${isCatCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="flex-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{cat.name}</span>
                            <span className={`text-[11px] font-medium ${cat.doneCount === cat.totalCount && cat.totalCount > 0 ? "text-green-600" : "text-gray-400"}`}>{cat.doneCount}/{cat.totalCount}</span>
                          </button>

                          {/* Column headers */}
                          {!isCatCollapsed && (
                            <div className="px-4 py-1 flex items-center gap-2 border-b border-gray-50">
                              <div className="w-20 flex-shrink-0" />
                              <div className="flex-1" />
                              <span className="w-28 flex-shrink-0 text-[10px] text-gray-400 font-medium uppercase hidden lg:block">MikeyBot</span>
                              <span className="w-36 flex-shrink-0 text-[10px] text-gray-400 font-medium uppercase hidden md:block">Evidence</span>
                            </div>
                          )}

                          {/* Items — collapsible */}
                          {!isCatCollapsed && cat.items.map((item) => {
                            const statusOpt = getStatusOption(item.status);
                            const notesValue = noteValues[item.id] ?? item.notes ?? "";
                            return (
                              <div key={item.id} id={`readiness-${item.id}`} className="px-4 py-2.5 border-b border-gray-50 last:border-b-0 group hover:bg-gray-50/30 transition-colors">
                                <div className="flex items-center gap-3">
                                  {/* Status dropdown — left */}
                                  <select
                                    value={item.status}
                                    onChange={(e) => updateItemStatus(item.id, e.target.value)}
                                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer flex-shrink-0 ${statusOpt.color}`}
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
                                        className="flex-shrink-0 text-[11px] text-purple-500 hover:text-purple-700 font-medium disabled:opacity-50"
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
                                        className="mt-1 text-xs text-purple-500 hover:text-purple-700 font-medium"
                                      >
                                        + Add notes
                                      </button>
                                    )}
                                  </div>

                                  {/* MikeyBot links column */}
                                  <div className="flex-shrink-0 w-28 hidden lg:block">
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
                                  <div className="flex-shrink-0 w-36 hidden md:block">
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
                                        <button onClick={() => setEditingEvidence(item.id)} className="text-xs text-gray-400 hover:text-blue-500 flex-shrink-0 transition-colors" title="Edit">✎</button>
                                        <button onClick={() => updateItemEvidenceUrl(item.id, "")} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0 transition-colors" title="Remove">✕</button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setEditingEvidence(item.id)}
                                        className="text-xs text-gray-400 hover:text-blue-600 font-medium transition-colors"
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

      {/* Sync Review Overlay */}
      {syncData && (
        <SyncReviewOverlay
          isOpen={showSyncOverlay}
          onClose={() => { setShowSyncOverlay(false); setSyncData(null); }}
          source={syncSource}
          proposedChanges={syncData.proposedChanges}
          recommendedStage={syncData.recommendedStage}
          onApply={handleApplySync}
        />
      )}
    </div>
  );
}
