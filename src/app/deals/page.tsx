"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import { useCmdEnterToSubmit } from "@/components/useCmdEnterToSubmit";
import { DEAL_STAGES, DEAL_STATUSES, getStatusInfo } from "@/lib/deals/constants";
import { mergePipeline, resolveStage, type CustomStage } from "@/lib/deals/stages";

interface Deal {
  id: string;
  name: string;
  companyName: string;
  stage: string;
  status: string;
  source: string | null;
  lastAnalysis: string | null;
  lastAnalyzedAt: string | null;
  updatedAt: string;
  createdAt: string;
  lastActivityAt: string | null;
  nextMeetingAt: string | null;
  dealValue: number | null;
  projectedCloseDate: string | null;
  _count: { entries: number; participants: number };
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffDay = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDay < 1) return "today";
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatNextMeeting(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = date.getTime() - Date.now();
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 1) {
    return date.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) + " today";
  }
  if (diffDay === 1) return "tomorrow";
  if (diffDay < 7) return `in ${diffDay}d`;
  if (diffDay < 30) return `in ${Math.floor(diffDay / 7)}w`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50">
          <SalesNavBar />
        </div>
      }
    >
      <DealsPageContent />
    </Suspense>
  );
}

function DealsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>(() => searchParams.get("stage") || "all");
  // Account-scoped custom stages merged into the pipeline alongside
  // the built-in DEAL_STAGES.
  const [customStages, setCustomStages] = useState<CustomStage[]>([]);
  const [showAddStage, setShowAddStage] = useState(false);
  const [newStageLabel, setNewStageLabel] = useState("");
  const NEW_STAGE_COLORS = [
    "bg-pink-100 text-pink-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
    "bg-teal-100 text-teal-700",
    "bg-lime-100 text-lime-700",
    "bg-emerald-100 text-emerald-700",
    "bg-sky-100 text-sky-700",
    "bg-yellow-100 text-yellow-700",
  ];
  const [newStageColor, setNewStageColor] = useState(NEW_STAGE_COLORS[0]);
  const [newStageInsertAfter, setNewStageInsertAfter] = useState<string>("");
  const [savingStage, setSavingStage] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  // Bulk selection state for Potential cards. Lets the user
  // multi-select and validate/dismiss in one shot from the action bar.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<{
    recorder: { available: boolean; scanned: number; potentials: number; attached: number; skipped: number; errors: number };
    calendar: { available: boolean; scanned: number; potentials: number; attached: number; skipped: number; errors: number };
  } | null>(null);
  // Inline edit popover for an existing custom stage.
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editStageLabel, setEditStageLabel] = useState("");
  const [editStageColor, setEditStageColor] = useState("");
  const [editStageInsertAfter, setEditStageInsertAfter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("status") || "active");
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams.get("q") || "");
  const [sortBy, setSortBy] = useState<string>(() => searchParams.get("sort") || "recent");
  const [sortBy2, setSortBy2] = useState<string>(() => searchParams.get("sort2") || "none");
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [newDealName, setNewDealName] = useState("");
  const [newDealCompany, setNewDealCompany] = useState("");
  const [creating, setCreating] = useState(false);
  const [suggestingName, setSuggestingName] = useState(false);
  const [importedCalls, setImportedCalls] = useState<Array<{
    title?: string;
    summary?: string;
    transcript?: string;
    recordingUrl?: string;
    date?: string;
    attendees?: Array<{ name: string; email?: string; title?: string; company?: string }>;
  }>>([]);

  const inferCompanyFromEmail = (email: string | undefined): string | null => {
    if (!email) return null;
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return null;
    const commonDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com"];
    if (commonDomains.includes(domain)) return null;
    // Extract the main part, capitalize
    const core = domain.split(".")[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  };

  const titleCase = (s: string) => s.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const loadDeals = useCallback(async () => {
    setLoading(true);
    try {
      const authRes = await fetch("/api/auth/me");
      const authData = await authRes.json();
      if (!authData.user) {
        router.push("/?error=not_logged_in");
        return;
      }
      const [dealsRes, connRes, stagesRes] = await Promise.all([
        fetch("/api/deals"),
        fetch("/api/meeting-recorder/connections"),
        fetch("/api/deals/stages"),
      ]);
      const loadedDeals: Deal[] = dealsRes.ok ? (await dealsRes.json()).deals || [] : [];
      setDeals(loadedDeals);
      if (stagesRes.ok) {
        const sd = await stagesRes.json();
        setCustomStages(sd.stages || []);
      }

      // First-run nudge: if the user has no deals yet AND hasn't connected
      // any meeting recorder, open the New Deal modal straight away. The
      // embedded MeetingRecorderPanel will surface the Connect CTAs for each
      // provider so the user lands on the integration prompt by default.
      if (loadedDeals.length === 0 && connRes.ok) {
        const connData = await connRes.json();
        const hasConnected = Array.isArray(connData.available)
          && connData.available.some((p: { connected?: boolean }) => p.connected);
        if (!hasConnected) setShowNewDeal(true);
      }
    } catch (error) {
      console.error("Failed to load deals:", error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = "Deals - Mikey";
    loadDeals();
  }, [loadDeals]);

  // Sync filter state → URL so the back button, refresh, and sharing
  // round-trip cleanly. Search query is debounced so each keystroke
  // doesn't push a history entry. Filters that match the default
  // value are omitted from the URL to keep it tidy.
  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (stageFilter !== "all") params.set("stage", stageFilter);
      if (statusFilter !== "active") params.set("status", statusFilter);
      if (sortBy !== "recent") params.set("sort", sortBy);
      if (sortBy2 !== "none") params.set("sort2", sortBy2);
      const q = searchQuery.trim();
      if (q) params.set("q", q);
      const current = searchParams.toString();
      // Preserve unrelated params (e.g. ?new=1) by stripping our keys
      // from the existing search and merging.
      const merged = new URLSearchParams(current);
      ["stage", "status", "q", "sort", "sort2"].forEach((k) => merged.delete(k));
      for (const [k, v] of params) merged.set(k, v);
      const target = merged.toString();
      if (target !== current) {
        router.replace(target ? `/deals?${target}` : "/deals", { scroll: false });
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [stageFilter, statusFilter, searchQuery, sortBy, sortBy2, router, searchParams]);

  // Auto-open the New Deal modal when landed on /deals?new=1 (used by the
  // "New Deal" CTA on the detail page).
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowNewDeal(true);
      // Clean the URL so refreshes don't keep re-opening the modal —
      // but preserve any filter params the user already had set.
      const merged = new URLSearchParams(searchParams.toString());
      merged.delete("new");
      const tail = merged.toString();
      router.replace(tail ? `/deals?${tail}` : "/deals", { scroll: false });
    }
  }, [searchParams, router]);

  const bulkUpdateStatus = async (status: "active" | "dismissed") => {
    if (bulkActing || bulkSelected.size === 0) return;
    const ids = Array.from(bulkSelected);
    setBulkActing(true);
    // Optimistic local update — the selected rows transition out of
    // the Potential filter view immediately.
    setDeals((prev) => prev.map((d) => (bulkSelected.has(d.id) ? { ...d, status } : d)));
    setBulkSelected(new Set());
    try {
      const res = await fetch("/api/deals/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: ids, status }),
      });
      if (!res.ok) {
        console.error("[deals] bulk update failed", res.status);
        loadDeals();
      }
    } catch (err) {
      console.error("[deals] bulk update error", err);
      loadDeals();
    } finally {
      setBulkActing(false);
    }
  };

  const handleDiscoverDeals = async () => {
    if (discovering) return;
    setDiscovering(true);
    setDiscoverResult(null);
    try {
      const res = await fetch("/api/deals/discover", { method: "POST" });
      if (!res.ok) {
        console.error("[deals] discover failed", res.status);
        return;
      }
      const summary = await res.json();
      setDiscoverResult(summary);
      await loadDeals();
      // If the sweep created any Potentials, flip the status filter to
      // "potential" so they appear right away — otherwise newly-created
      // dashed-purple cards stay hidden behind the default "active"
      // filter and the discovery looks like a no-op.
      const newPotentials =
        (summary?.recorder?.potentials || 0) + (summary?.calendar?.potentials || 0);
      if (newPotentials > 0) {
        setStatusFilter("potential");
      }
    } catch (err) {
      console.error("[deals] discover error", err);
    } finally {
      setDiscovering(false);
    }
  };

  const createDeal = async () => {
    if (!newDealName.trim() || !newDealCompany.trim()) return;
    setCreating(true);
    try {
      // 1) Create the deal
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDealName.trim(),
          companyName: newDealCompany.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to create deal");
      const { deal } = await res.json();

      // 2) If there are imported calls, create a timeline entry per call + deduped participants
      if (importedCalls.length > 0) {
        // Create one timeline entry per call, oldest first so newest shows at top of timeline
        const sorted = [...importedCalls].sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return da - db;
        });
        for (const call of sorted) {
          const headerLines: string[] = [];
          if (call.date) {
            headerLines.push(`Call Date: ${new Date(call.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
          }
          if (call.attendees?.length) {
            const formatted = call.attendees.map((a) => {
              const name = a.name.includes("@") ? a.name : titleCase(a.name);
              const parts = [name];
              if (a.title) parts[0] += `, ${titleCase(a.title)}`;
              if (a.company) parts[0] += ` @ ${titleCase(a.company)}`;
              if (a.email) parts.push(a.email);
              return parts.join(" — ");
            });
            headerLines.push(`Attendees:\n${formatted.map((f) => `  - ${f}`).join("\n")}`);
          }
          const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
          const summaryPart = call.summary ? `## Summary\n\n${call.summary}\n\n` : "";
          const transcriptPart = call.transcript ? `## Transcript\n\n${call.transcript}` : "";

          await fetch(`/api/deals/${deal.id}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "call_transcript",
              title: call.title,
              content: header + summaryPart + transcriptPart,
              sourceUrl: call.recordingUrl,
              entryDate: call.date ? new Date(call.date).toISOString() : undefined,
            }),
          });
        }

        // Dedupe participants across all calls by email (or by name if no email)
        const participantMap = new Map<string, { name: string; email?: string; title?: string; company?: string }>();
        for (const call of importedCalls) {
          for (const a of call.attendees || []) {
            if (!a.name) continue;
            const key = (a.email || a.name).toLowerCase();
            const existing = participantMap.get(key);
            if (!existing) {
              participantMap.set(key, { name: a.name, email: a.email, title: a.title, company: a.company });
            } else {
              // Fill in any missing fields from later occurrences
              if (!existing.title && a.title) existing.title = a.title;
              if (!existing.company && a.company) existing.company = a.company;
              if (!existing.email && a.email) existing.email = a.email;
            }
          }
        }
        for (const p of participantMap.values()) {
          await fetch(`/api/deals/${deal.id}/participants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: p.name,
              title: p.title,
              company: p.company,
              email: p.email,
              role: "unknown",
            }),
          });
        }
      }

      // Auto-enrich all participants missing titles (non-blocking)
      fetch(`/api/deals/${deal.id}/participants/enrich-all`, { method: "POST" }).catch(() => {});

      router.push(`/deals/${deal.id}`);
    } catch (error) {
      console.error("Failed to create deal:", error);
      setCreating(false);
    }
  };

  useCmdEnterToSubmit(createDeal, showNewDeal && !!newDealName.trim() && !!newDealCompany.trim() && !creating);

  const resetNewDealForm = () => {
    setShowNewDeal(false);
    setNewDealName("");
    setNewDealCompany("");
    setImportedCalls([]);
  };

  const filteredDeals = (() => {
    const filtered = deals.filter((d) => {
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (q && !d.name.toLowerCase().includes(q) && !d.companyName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    // Pipeline order for the stage sort. Built-ins anchored to
    // mergePipeline so custom stages slot in at the right index.
    const pipelineIndex = new Map(mergePipeline(customStages).map((s, i) => [s.value, i]));

    const cmpDateDesc = (a: string | null, b: string | null) => {
      // Nulls sink to the bottom for a "X first" sort.
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return new Date(b).getTime() - new Date(a).getTime();
    };
    const cmpDateAsc = (a: string | null, b: string | null) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return new Date(a).getTime() - new Date(b).getTime();
    };

    const makeComparator = (key: string): ((a: Deal, b: Deal) => number) => {
      switch (key) {
        case "last_activity":
          return (a, b) => cmpDateDesc(a.lastActivityAt, b.lastActivityAt);
        case "next_meeting":
          return (a, b) => cmpDateAsc(a.nextMeetingAt, b.nextMeetingAt);
        case "created_new":
          return (a, b) => cmpDateDesc(a.createdAt, b.createdAt);
        case "created_old":
          return (a, b) => cmpDateAsc(a.createdAt, b.createdAt);
        case "value_high":
          return (a, b) => (b.dealValue ?? -1) - (a.dealValue ?? -1);
        case "stage":
          return (a, b) =>
            (pipelineIndex.get(a.stage) ?? 99) - (pipelineIndex.get(b.stage) ?? 99);
        case "projected_close":
          return (a, b) => cmpDateAsc(a.projectedCloseDate, b.projectedCloseDate);
        case "recent":
          return (a, b) => cmpDateDesc(a.updatedAt, b.updatedAt);
        default:
          return () => 0;
      }
    };

    const primary = makeComparator(sortBy);
    const secondary = sortBy2 !== "none" && sortBy2 !== sortBy ? makeComparator(sortBy2) : null;
    return [...filtered].sort((a, b) => {
      const p = primary(a, b);
      if (p !== 0 || !secondary) return p;
      return secondary(a, b);
    });
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-1">💼 Deals</h1>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Track your active sales opportunities — timeline of calls, emails, notes, and AI-powered next actions.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDiscoverDeals}
              disabled={discovering}
              className="px-3 py-2 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 bg-white dark:bg-gray-800 rounded-lg font-medium text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {discovering ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Looking…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Look for new deals
                </>
              )}
            </button>
            <button
              onClick={() => setShowNewDeal(true)}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-medium text-sm shadow hover:shadow-md transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              New Deal
            </button>
          </div>
        </div>

        {discoverResult && (
          <div className="mb-4 p-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-sm flex items-start justify-between gap-3">
            <div className="text-gray-700 dark:text-gray-200">
              <div className="font-medium mb-0.5">Discovery sweep complete</div>
              <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                {discoverResult.recorder.available ? (
                  <div>
                    Recorder: scanned {discoverResult.recorder.scanned}, {discoverResult.recorder.potentials} new potential,{" "}
                    {discoverResult.recorder.attached} attached to existing deals.
                    {discoverResult.recorder.errors > 0 && (
                      <span className="text-red-600 dark:text-red-400"> · {discoverResult.recorder.errors} error{discoverResult.recorder.errors === 1 ? "" : "s"}</span>
                    )}
                  </div>
                ) : (
                  <div className="italic">Recorder not connected — skipped.</div>
                )}
                {discoverResult.calendar.available ? (
                  <div>
                    Calendar (30d): scanned {discoverResult.calendar.scanned}, {discoverResult.calendar.potentials} new potential,{" "}
                    {discoverResult.calendar.attached} attached to existing deals.
                    {discoverResult.calendar.errors > 0 && (
                      <span className="text-red-600 dark:text-red-400"> · {discoverResult.calendar.errors} error{discoverResult.calendar.errors === 1 ? "" : "s"}</span>
                    )}
                  </div>
                ) : (
                  <div className="italic">Calendar not connected — skipped.</div>
                )}
                {(discoverResult.recorder.potentials + discoverResult.calendar.potentials) > 0 && (
                  <div className="mt-1 text-purple-700 dark:text-purple-300">
                    Showing the new ones under the <strong>Potential</strong> status filter — Validate or Dismiss to clear.
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setDiscoverResult(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Search + sort */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deals by name or company..."
            className="w-full pl-10 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          Sort:
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
          >
            <option value="recent">Recently updated</option>
            <option value="last_activity">Last activity</option>
            <option value="next_meeting">Next meeting (soonest)</option>
            <option value="created_new">Created (newest)</option>
            <option value="created_old">Created (oldest)</option>
            <option value="value_high">Deal size (highest)</option>
            <option value="stage">Stage (pipeline order)</option>
            <option value="projected_close">Projected close (soonest)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          Then by:
          <select
            value={sortBy2}
            onChange={(e) => setSortBy2(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
          >
            <option value="none">— none —</option>
            <option value="recent" disabled={sortBy === "recent"}>Recently updated</option>
            <option value="last_activity" disabled={sortBy === "last_activity"}>Last activity</option>
            <option value="next_meeting" disabled={sortBy === "next_meeting"}>Next meeting (soonest)</option>
            <option value="created_new" disabled={sortBy === "created_new"}>Created (newest)</option>
            <option value="created_old" disabled={sortBy === "created_old"}>Created (oldest)</option>
            <option value="value_high" disabled={sortBy === "value_high"}>Deal size (highest)</option>
            <option value="stage" disabled={sortBy === "stage"}>Stage (pipeline order)</option>
            <option value="projected_close" disabled={sortBy === "projected_close"}>Projected close (soonest)</option>
          </select>
        </label>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap text-sm relative">
          <span className="text-gray-500 dark:text-gray-400 text-xs font-medium uppercase tracking-wider">Stage:</span>
          <button
            onClick={() => setStageFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
          >
            All
          </button>
          {mergePipeline(customStages).map((s) => (
            <span key={s.value} className="relative inline-flex items-center">
              <button
                onClick={() => setStageFilter(s.value)}
                onContextMenu={(e) => {
                  if (s.builtin) return;
                  e.preventDefault();
                  setEditingStageId(s.customId ?? null);
                  setEditStageLabel(s.label);
                  setEditStageColor(s.color);
                  const cust = customStages.find((c) => c.id === s.customId);
                  setEditStageInsertAfter(cust?.insertAfter || "");
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === s.value ? "bg-gray-900 text-white" : `${s.color} hover:opacity-80`}`}
                title={s.builtin ? "Built-in stage" : "Click to filter · right-click to edit"}
              >
                {s.label}
                {!s.builtin && <span className="ml-1 opacity-50">✎</span>}
              </button>
              {editingStageId === s.customId && (
                <div className="absolute left-0 top-full mt-2 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Edit stage
                  </div>
                  <input
                    type="text"
                    value={editStageLabel}
                    onChange={(e) => setEditStageLabel(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-1 mb-2">
                    {NEW_STAGE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditStageColor(c)}
                        className={`w-6 h-6 rounded-full ${c.split(" ")[0]} ${editStageColor === c ? "ring-2 ring-offset-1 ring-purple-500" : ""}`}
                      />
                    ))}
                  </div>
                  <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Insert after</label>
                  <select
                    value={editStageInsertAfter}
                    onChange={(e) => setEditStageInsertAfter(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md mb-3"
                  >
                    <option value="">— end of pipeline —</option>
                    {DEAL_STAGES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={async () => {
                        if (!editingStageId) return;
                        if (!confirm("Archive this stage? Existing deals stay on it; it just stops showing in the picker.")) return;
                        await fetch(`/api/deals/stages/${editingStageId}`, { method: "DELETE" });
                        setCustomStages((prev) => prev.filter((c) => c.id !== editingStageId));
                        setEditingStageId(null);
                      }}
                      className="text-xs text-red-600 dark:text-red-300 hover:underline"
                    >
                      Archive
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingStageId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          if (!editingStageId) return;
                          const res = await fetch(`/api/deals/stages/${editingStageId}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              label: editStageLabel.trim(),
                              color: editStageColor,
                              insertAfter: editStageInsertAfter || null,
                            }),
                          });
                          if (res.ok) {
                            const d = await res.json();
                            setCustomStages((prev) => prev.map((c) => c.id === d.stage.id ? d.stage : c));
                            setEditingStageId(null);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </span>
          ))}
          <button
            onClick={() => setShowAddStage((v) => !v)}
            className="px-2 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-300 transition-colors"
            title="Add a custom stage"
          >
            + Add stage
          </button>
          {showAddStage && (
            <div className="absolute right-0 top-full mt-2 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                New stage
              </div>
              <input
                type="text"
                value={newStageLabel}
                onChange={(e) => setNewStageLabel(e.target.value)}
                placeholder="e.g. Vendor Review"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <div className="flex flex-wrap gap-1 mb-2">
                {NEW_STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewStageColor(c)}
                    className={`w-6 h-6 rounded-full ${c.split(" ")[0]} ${newStageColor === c ? "ring-2 ring-offset-1 ring-purple-500" : ""}`}
                    title={c.split("-")[1]}
                  />
                ))}
              </div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Insert after</label>
              <select
                value={newStageInsertAfter}
                onChange={(e) => setNewStageInsertAfter(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md mb-3"
              >
                <option value="">— end of pipeline —</option>
                {DEAL_STAGES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowAddStage(false); setNewStageLabel(""); }}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const label = newStageLabel.trim();
                    if (!label || savingStage) return;
                    setSavingStage(true);
                    try {
                      const res = await fetch("/api/deals/stages", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ label, color: newStageColor, insertAfter: newStageInsertAfter || null }),
                      });
                      if (res.ok) {
                        const d = await res.json();
                        setCustomStages((prev) => [...prev, d.stage]);
                        setNewStageLabel("");
                        setNewStageInsertAfter("");
                        setShowAddStage(false);
                      }
                    } finally {
                      setSavingStage(false);
                    }
                  }}
                  disabled={!newStageLabel.trim() || savingStage}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50"
                >
                  {savingStage ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mb-6 flex-wrap text-sm">
          <span className="text-gray-500 dark:text-gray-400 text-xs font-medium uppercase tracking-wider">Status:</span>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
          >
            All
          </button>
          {DEAL_STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === s.value ? "bg-gray-900 text-white" : `${s.color} hover:opacity-80`}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Deal grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="h-5 w-48 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center">
            <div className="text-5xl mb-3">💼</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {deals.length === 0 ? "No deals yet" : "No deals match these filters"}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
              {deals.length === 0 ? "Create your first deal to start tracking engagement artifacts and get AI-powered next actions." : "Try adjusting the stage or status filters above."}
            </p>
            {deals.length === 0 && (
              <button
                onClick={() => setShowNewDeal(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-medium text-sm"
              >
                + Create Your First Deal
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Bulk-select action bar — appears whenever any Potential
                cards are checked. Lets the user validate or dismiss
                them in one shot. */}
            {bulkSelected.size > 0 && (() => {
              const visiblePotentialIds = filteredDeals
                .filter((d) => d.status === "potential")
                .map((d) => d.id);
              const allVisibleSelected =
                visiblePotentialIds.length > 0 &&
                visiblePotentialIds.every((id) => bulkSelected.has(id));
              return (
                <div className="sticky top-2 z-10 mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-purple-300 bg-purple-50 dark:bg-purple-900/30 dark:border-purple-700 shadow-sm">
                  <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    {bulkSelected.size} selected
                  </span>
                  <button
                    onClick={() => {
                      if (allVisibleSelected) {
                        setBulkSelected(new Set());
                      } else {
                        setBulkSelected(new Set(visiblePotentialIds));
                      }
                    }}
                    className="text-xs text-purple-700 dark:text-purple-300 hover:underline"
                  >
                    {allVisibleSelected ? "Clear selection" : `Select all visible (${visiblePotentialIds.length})`}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => bulkUpdateStatus("active")}
                    disabled={bulkActing}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                  >
                    ✓ Validate {bulkSelected.size}
                  </button>
                  <button
                    onClick={() => bulkUpdateStatus("dismissed")}
                    disabled={bulkActing}
                    className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
                  >
                    ✕ Dismiss {bulkSelected.size}
                  </button>
                </div>
              );
            })()}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredDeals.map((deal) => {
              const stageInfo = resolveStage(deal.stage, customStages);
              const statusInfo = getStatusInfo(deal.status);
              const pipeline = mergePipeline(customStages);
              const patchDeal = async (patch: { stage?: string; status?: string }) => {
                setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, ...patch } : d)));
                try {
                  await fetch(`/api/deals/${deal.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                } catch (err) {
                  console.error("[deals] inline patch failed:", err);
                  loadDeals();
                }
              };
              return (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className={`block text-left bg-white dark:bg-gray-800 border rounded-xl p-5 hover:shadow-md transition-all group ${deal.status === "potential" ? "border-purple-300 border-dashed hover:border-purple-500" : "border-gray-200 dark:border-gray-700 hover:border-purple-300"}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1 flex items-start gap-2">
                      {deal.status === "potential" && (
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(deal.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setBulkSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(deal.id);
                              else next.delete(deal.id);
                              return next;
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 accent-purple-600 cursor-pointer"
                          title="Select for bulk action"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{deal.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{deal.companyName}</p>
                      </div>
                    </div>
                    <InlinePillSelect
                      currentValue={stageInfo.value}
                      currentLabel={stageInfo.label}
                      currentColor={stageInfo.color}
                      options={pipeline.map((p) => ({ value: p.value, label: p.label, color: p.color }))}
                      onChange={(value) => patchDeal({ stage: value })}
                    />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-3 flex-wrap">
                    <InlinePillSelect
                      currentValue={statusInfo.value}
                      currentLabel={statusInfo.label}
                      currentColor={statusInfo.color}
                      options={DEAL_STATUSES.map((s) => ({ value: s.value, label: s.label, color: s.color }))}
                      onChange={(value) => patchDeal({ status: value })}
                    />
                    <span>· {deal._count.entries} {deal._count.entries === 1 ? "entry" : "entries"}</span>
                    <span>· {deal._count.participants} {deal._count.participants === 1 ? "person" : "people"}</span>
                    {typeof deal.dealValue === "number" && deal.dealValue > 0 && (
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        · ${deal.dealValue.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {deal.status === "potential" && (
                    <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          setDeals((prev) =>
                            prev.map((d) => (d.id === deal.id ? { ...d, status: "active" } : d))
                          );
                          try {
                            await fetch(`/api/deals/${deal.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "active" }),
                            });
                          } catch (err) {
                            console.error("[deals] validate failed:", err);
                            loadDeals();
                          }
                        }}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-600 text-white hover:bg-purple-700"
                      >
                        ✓ Validate
                      </button>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          setDeals((prev) =>
                            prev.map((d) => (d.id === deal.id ? { ...d, status: "dismissed" } : d))
                          );
                          try {
                            await fetch(`/api/deals/${deal.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "dismissed" }),
                            });
                          } catch (err) {
                            console.error("[deals] dismiss failed:", err);
                            loadDeals();
                          }
                        }}
                        className="px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50"
                      >
                        ✕ Dismiss
                      </button>
                      <span className="text-[11px] text-purple-600 dark:text-purple-300 ml-1">
                        Auto-detected from {deal.source === "calendar" ? "an upcoming calendar meeting" : "a recent recording"}
                      </span>
                    </div>
                  )}
                  <div className="text-xs mt-2 flex items-center gap-3 flex-wrap">
                    {deal.lastActivityAt ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        Last activity {formatRelative(deal.lastActivityAt)}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">No activity yet</span>
                    )}
                    {deal.nextMeetingAt ? (
                      <span className="text-purple-700 dark:text-purple-300 font-medium">
                        📅 Next meeting {formatNextMeeting(deal.nextMeetingAt)}
                      </span>
                    ) : (
                      deal.status === "active" || deal.status === "stalled" ? (
                        <span className="text-amber-600 dark:text-amber-400">⚠ No upcoming meeting</span>
                      ) : null
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* New Deal Modal */}
      {showNewDeal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetNewDealForm(); }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">New Deal</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Select all the calls for a deal to automatically build its timeline, or create one manually.
            </p>

            {/* Import from Meeting Recorder */}
            <div className="mb-4">
              <MeetingRecorderPanel
                defaultCollapsed={false}
                onSelectCalls={(calls) => {
                  if (calls.length === 0) return;
                  setImportedCalls((prev) => {
                    const seen = new Set(prev.map((c) => c.recordingUrl || `${c.title}|${c.date}`));
                    const merged = [...prev];
                    for (const c of calls) {
                      const key = c.recordingUrl || `${c.title}|${c.date}`;
                      if (!seen.has(key)) {
                        merged.push(c);
                        seen.add(key);
                      }
                    }
                    return merged;
                  });
                  // Instant fallback: infer from email domain + call title
                  for (const data of calls) {
                    const externalAttendee = data.attendees?.find((a) => inferCompanyFromEmail(a.email) != null);
                    const inferredCompany = externalAttendee?.company
                      || inferCompanyFromEmail(externalAttendee?.email)
                      || "";
                    if (inferredCompany) {
                      setNewDealCompany((prev) => prev.trim() ? prev : inferredCompany);
                      break;
                    }
                  }
                  // Deliberately NOT pre-filling with calls[0].title — call
                  // titles make bad deal names ("[HOLD] inDrive <> Mesh -
                  // Check-In"). Show a loading state and let the AI suggest
                  // a proper opportunity name.
                  setSuggestingName(true);
                  fetch("/api/deals/suggest-name", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ calls }),
                  })
                    .then((r) => r.json())
                    .then((data) => {
                      if (data.companyName) setNewDealCompany((prev) => prev.trim() ? prev : data.companyName);
                      if (data.dealName) setNewDealName((prev) => prev.trim() ? prev : data.dealName);
                    })
                    .catch(() => {})
                    .finally(() => setSuggestingName(false));
                }}
              />
            </div>

            {importedCalls.length > 0 && (
              <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-purple-900">
                    ✓ {importedCalls.length} call{importedCalls.length === 1 ? "" : "s"} imported
                  </p>
                  <button
                    onClick={() => setImportedCalls([])}
                    className="text-xs text-purple-600 hover:text-purple-800"
                  >
                    Clear all
                  </button>
                </div>
                <ul className="space-y-1">
                  {[...importedCalls]
                    .map((call, origIdx) => ({ call, origIdx }))
                    .sort((a, b) => {
                      // Newest first — matches timeline display order
                      const da = a.call.date ? new Date(a.call.date).getTime() : 0;
                      const db = b.call.date ? new Date(b.call.date).getTime() : 0;
                      return db - da;
                    })
                    .map(({ call, origIdx }) => (
                    <li key={(call.recordingUrl || "") + origIdx} className="flex items-center justify-between gap-2 text-xs text-purple-800">
                      <span className="truncate">
                        {call.date && (
                          <span className="text-purple-500 mr-1.5">
                            {new Date(call.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                        <span className="font-medium">{call.title || "Untitled"}</span>
                        <span className="text-purple-600"> · {call.attendees?.length || 0} attendee{(call.attendees?.length || 0) === 1 ? "" : "s"}</span>
                      </span>
                      <button
                        onClick={() => setImportedCalls((prev) => prev.filter((_, idx) => idx !== origIdx))}
                        className="text-purple-500 hover:text-purple-800 flex-shrink-0"
                        aria-label="Remove call"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-purple-600 mt-2">
                  Each call becomes a timeline entry. Attendees are deduped and added as participants.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Company Name</label>
                <input
                  type="text"
                  value={newDealCompany}
                  onChange={(e) => setNewDealCompany(e.target.value)}
                  placeholder="e.g., Visana Health"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-1.5">
                  Deal Name
                  {suggestingName && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-purple-600">
                      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      suggesting...
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={newDealName}
                  onChange={(e) => setNewDealName(e.target.value)}
                  placeholder={suggestingName ? "Mikey is naming the deal..." : "e.g., Visana — Enterprise Pilot"}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => { if (e.key === "Enter") createDeal(); }}
                />
                <p className="text-[11px] text-gray-400 mt-1">Name the opportunity, not the meeting — e.g. &quot;Acme — Platform Rollout&quot;, not &quot;Acme &lt;&gt; Mesh Weekly Sync&quot;.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetNewDealForm} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
              <button
                onClick={createDeal}
                disabled={!newDealName.trim() || !newDealCompany.trim() || creating}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {creating
                  ? <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Creating...</span>
                  : importedCalls.length > 1
                    ? `Create Deal from ${importedCalls.length} Calls`
                    : importedCalls.length === 1
                      ? "Create Deal from Call"
                      : "Create Deal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PillOption {
  value: string;
  label: string;
  color: string;
}

function InlinePillSelect({
  currentValue,
  currentLabel,
  currentColor,
  options,
  onChange,
}: {
  currentValue: string;
  currentLabel: string;
  currentColor: string;
  options: PillOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:ring-2 hover:ring-purple-300 ${currentColor}`}
        title={`Change ${currentLabel}`}
      >
        {currentLabel}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                if (opt.value !== currentValue) onChange(opt.value);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                opt.value === currentValue ? "font-semibold" : ""
              }`}
            >
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${opt.color}`}>
                {opt.label}
              </span>
              {opt.value === currentValue && (
                <svg className="w-3 h-3 text-purple-600 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
