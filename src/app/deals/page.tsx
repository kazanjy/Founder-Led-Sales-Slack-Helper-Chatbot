"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import CalendarEventPicker, { type CalendarPickerEvent } from "@/components/CalendarEventPicker";
import { useCmdEnterToSubmit } from "@/components/useCmdEnterToSubmit";
import { DEAL_STAGES, DEAL_STATUSES, MIKEY_HEALTH_LEVELS, getStatusInfo, getRoleInfo, getHealthInfo } from "@/lib/deals/constants";
import { mergePipeline, resolveStage, type CustomStage } from "@/lib/deals/stages";
import { parseDealAnalysis } from "@/lib/deals/parse-analysis";

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
  mikeyHealth: string | null;
  projectedCloseDate: string | null;
  _count: { entries: number; participants: number };
  participants?: Array<{
    id: string;
    name: string;
    email: string | null;
    role: string;
    title: string | null;
  }>;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Render a participant's "card name" — prefer a real first/last name,
// then a derived name from their email local-part, then the email
// itself. Keeps chips tight and human-readable on busy cards.
function participantChipLabel(p: { name: string; email: string | null }): string {
  const raw = (p.name || "").trim();
  if (raw && !raw.includes("@")) return raw;
  const source = raw || p.email || "";
  const local = source.includes("@") ? source.split("@")[0] : source;
  if (!local) return source;
  // Convert "peter.kazanjy" / "peter_kazanjy" / "peter-k" → "Peter Kazanjy"
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b([a-z])/gi, (m) => m.toUpperCase())
    .trim();
}

// Sort participants for chip display — decision-makers first, then
// champions, influencers, blockers, end users, unknown. Within a role
// the API already returns createdAt-ascending so it's stable.
const ROLE_RANK: Record<string, number> = {
  decision_maker: 0,
  champion: 1,
  influencer: 2,
  blocker: 3,
  end_user: 4,
  unknown: 5,
};

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  // Compare calendar-day midnights in local time so "today" / "yesterday"
  // line up with what the user actually sees on a calendar, not raw
  // elapsed-hours-divided-by-24.
  const diffDay = Math.round((startOfLocalDay(new Date()) - startOfLocalDay(date)) / 86400000);
  if (diffDay <= 0) return "today";
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatNextMeeting(dateStr: string): string {
  const date = new Date(dateStr);
  const diffDay = Math.round((startOfLocalDay(date) - startOfLocalDay(new Date())) / 86400000);
  if (diffDay <= 0) {
    return date.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) + " today";
  }
  if (diffDay === 1) return "tomorrow";
  if (diffDay < 7) return `in ${diffDay}d`;
  if (diffDay < 30) return `in ${Math.floor(diffDay / 7)}w`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Natural direction for each sort option — the one the dropdown
// label implies (e.g. "Deal size (highest)" is desc). Picking a new
// sort option resets sortDir to its natural. The arrow toggle flips
// it. URL omits ?dir when it matches natural to keep links clean.
const NATURAL_DIR: Record<string, "asc" | "desc"> = {
  recent: "desc",
  last_activity: "desc",
  next_meeting: "asc",
  created_new: "desc",
  created_old: "asc",
  value_high: "desc",
  stage: "asc",
  projected_close: "asc",
  name_az: "asc",
  company_az: "asc",
  none: "desc",
};

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

// localStorage key for the deals page's persisted view config. Bump
// the version suffix if the shape changes so stale blobs get ignored.
const VIEW_STATE_KEY = "deals:viewState:v1";

type StoredView = Partial<{
  stage: string;
  status: string;
  sort: string;
  sort2: string;
  dir: string;
  dir2: string;
  layout: string;
  health: string;
  meeting: string;
  activity: string;
}>;

function readStoredView(): StoredView {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as StoredView : {};
  } catch {
    return {};
  }
}

function writeStoredView(view: StoredView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(view));
  } catch {
    // localStorage might be disabled / full — degrade silently.
  }
}

function DealsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  // Persisted view-state lives in localStorage so the user lands back
  // on the same sort / layout / filter set they last used. URL params
  // still win when present (shareable links, back-button), but a clean
  // /deals visit falls back to whatever they had last time.
  const [storedView] = useState<StoredView>(() => readStoredView());
  const pick = (key: keyof StoredView, paramKey: string, fallback: string) =>
    searchParams.get(paramKey) || storedView[key] || fallback;
  const [stageFilter, setStageFilter] = useState<string>(() => pick("stage", "stage", "all"));
  // Account-scoped custom stages merged into the pipeline alongside
  // the built-in DEAL_STAGES.
  const [customStages, setCustomStages] = useState<CustomStage[]>([]);
  // Built-in stage values the account has hidden from the picker.
  // Cards on archived stages still render with their label via
  // resolveStage; this just gates which chips appear in the filter row.
  const [archivedBuiltinStages, setArchivedBuiltinStages] = useState<string[]>([]);
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
  const [scanningCalendar, setScanningCalendar] = useState(false);
  const [calendarScanResult, setCalendarScanResult] = useState<{ hasCalendar: boolean; dealsScanned: number; totalEventsAdded: number; perDeal: Array<{ dealId: string; dealName: string; added: number; skipped: number }> } | null>(null);
  // Bulk analyze state — drives the inline progress banner that shows
  // each visible deal's analyzer status as the SSE stream lands.
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState<{
    total: number;
    current: number;
    currentDealName: string | null;
    rows: Array<{ dealId: string; dealName: string; status: "analyzing" | "done" | "failed"; mikeyHealth?: string; healthFlipped?: boolean; error?: string }>;
    summary: { analyzed: number; failed: number; healthFlips: number } | null;
  } | null>(null);
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
  const [statusFilter, setStatusFilter] = useState<string>(() => pick("status", "status", "active"));
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams.get("q") || "");
  const [sortBy, setSortBy] = useState<string>(() => pick("sort", "sort", "recent"));
  const [sortBy2, setSortBy2] = useState<string>(() => pick("sort2", "sort2", "none"));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (pick("dir", "dir", "desc") as "asc" | "desc"));
  const [sortDir2, setSortDir2] = useState<"asc" | "desc">(() => (pick("dir2", "dir2", "desc") as "asc" | "desc"));
  const [layout, setLayout] = useState<"grid" | "list">(() => (pick("layout", "layout", "list") as "grid" | "list"));
  const [healthFilter, setHealthFilter] = useState<string>(() => pick("health", "health", "all"));
  const [meetingFilter, setMeetingFilter] = useState<string>(() => pick("meeting", "meeting", "all"));
  const [activityFilter, setActivityFilter] = useState<string>(() => pick("activity", "activity", "all"));
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
  // Calendar-tab state for the New Deal modal — parallel to importedCalls.
  // Each picked event lands here, gets surfaced in the same purple
  // confirmation panel, and turns into a "meeting" timeline entry on
  // create.
  const [importedCalendarEvents, setImportedCalendarEvents] = useState<Array<{
    id: string;
    title: string;
    startsAt: string;
    description: string | null;
    meetingUrl: string | null;
    eventUrl: string | null;
    inferredCompany: { name: string; url: string } | null;
    attendees: Array<{ email: string; name: string | null }>;
  }>>([]);
  const [newDealSourceTab, setNewDealSourceTab] = useState<"recorder" | "calendar">("recorder");
  // Phase 4: prior pre-call briefs surfaced for the deal's domain.
  // Populated whenever the company name changes (debounced) or a
  // recorder call / calendar event with an external domain gets
  // imported. Multi-select; selected ones get attached as
  // research_brief timeline entries on Create Deal.
  const [priorBriefs, setPriorBriefs] = useState<Array<{
    id: string;
    companyName: string;
    contactName: string | null;
    contactTitle: string | null;
    createdAt: string;
    preview: string;
  }>>([]);
  const [selectedPriorBriefIds, setSelectedPriorBriefIds] = useState<Set<string>>(new Set());

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

  // Phase 4: whenever the prospect identity changes in the New Deal
  // modal (company name typed, calls / events imported), look up any
  // prior Pre-Call Plans the user generated for that domain. Surfaces
  // them so the founder can attach them to the new deal at create
  // time instead of orphaning historical research.
  useEffect(() => {
    if (!showNewDeal) return;
    // Derive the best lookup signal: an external attendee email
    // domain from any imported call/event wins (most specific),
    // otherwise fall back to the typed company name.
    const callEmails = importedCalls.flatMap((c) => c.attendees?.map((a) => a.email).filter((e): e is string => !!e) || []);
    const eventEmails = importedCalendarEvents.flatMap((e) => e.attendees.map((a) => a.email));
    const PUBLIC = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com"]);
    let domain: string | null = null;
    for (const email of [...callEmails, ...eventEmails]) {
      const d = email.split("@")[1]?.toLowerCase();
      if (d && !PUBLIC.has(d)) { domain = d; break; }
    }
    if (!domain && newDealCompany.trim()) {
      // No imports yet — fall back to the typed company name as a
      // domain root. The by-domain endpoint matches companyName
      // ILIKE %root% so "Acme" finds briefs created for "Acme Corp".
      domain = newDealCompany.trim().toLowerCase().split(/\s+/)[0];
    }
    if (!domain) {
      setPriorBriefs([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch(`/api/pre-call-planning/research/by-domain?domain=${encodeURIComponent(domain!)}&days=90`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.briefs) {
            setPriorBriefs(data.briefs);
            // Default: pre-select all matches so the founder gets the
            // benefit without an extra click. They can uncheck any.
            setSelectedPriorBriefIds(new Set(data.briefs.map((b: { id: string }) => b.id)));
          }
        })
        .catch(() => { /* silent — non-critical */ });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [showNewDeal, newDealCompany, importedCalls, importedCalendarEvents]);

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
        setArchivedBuiltinStages(Array.isArray(sd.archivedBuiltinStages) ? sd.archivedBuiltinStages : []);
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
      if (sortDir !== NATURAL_DIR[sortBy]) params.set("dir", sortDir);
      if (sortBy2 !== "none" && sortDir2 !== NATURAL_DIR[sortBy2]) params.set("dir2", sortDir2);
      if (layout !== "list") params.set("layout", layout);
      if (healthFilter !== "all") params.set("health", healthFilter);
      if (meetingFilter !== "all") params.set("meeting", meetingFilter);
      if (activityFilter !== "all") params.set("activity", activityFilter);
      const q = searchQuery.trim();
      if (q) params.set("q", q);
      // Mirror the same config into localStorage so a clean /deals
      // visit (no params) restores the user's last view. Search query
      // is intentionally not persisted — it's per-session intent.
      writeStoredView({
        stage: stageFilter,
        status: statusFilter,
        sort: sortBy,
        sort2: sortBy2,
        dir: sortDir,
        dir2: sortDir2,
        layout,
        health: healthFilter,
        meeting: meetingFilter,
        activity: activityFilter,
      });
      const current = searchParams.toString();
      // Preserve unrelated params (e.g. ?new=1) by stripping our keys
      // from the existing search and merging.
      const merged = new URLSearchParams(current);
      ["stage", "status", "q", "sort", "sort2", "dir", "dir2", "layout", "health", "meeting", "activity"].forEach((k) => merged.delete(k));
      for (const [k, v] of params) merged.set(k, v);
      const target = merged.toString();
      if (target !== current) {
        router.replace(target ? `/deals?${target}` : "/deals", { scroll: false });
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [stageFilter, statusFilter, searchQuery, sortBy, sortBy2, sortDir, sortDir2, layout, healthFilter, meetingFilter, activityFilter, router, searchParams]);

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

  const runBulkAnalyzeForIds = async (ids: string[]) => {
    if (bulkAnalyzing || ids.length === 0) return;
    setBulkAnalyzing(true);
    setBulkAnalyzeProgress({
      total: ids.length,
      current: 0,
      currentDealName: null,
      rows: [],
      summary: null,
    });

    try {
      const res = await fetch("/api/deals/bulk-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: ids }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        console.error("[deals] bulk-analyze failed", res.status, text);
        setBulkAnalyzing(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // Parse SSE frames: each event is "event: X\ndata: {...}\n\n".
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let frameEnd = buf.indexOf("\n\n");
        while (frameEnd !== -1) {
          const frame = buf.slice(0, frameEnd);
          buf = buf.slice(frameEnd + 2);
          frameEnd = buf.indexOf("\n\n");
          const lines = frame.split("\n");
          let event = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!event || !dataStr) continue;
          let data: unknown;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (event === "started") {
            const d = data as { total: number };
            setBulkAnalyzeProgress((prev) => prev && { ...prev, total: d.total });
          } else if (event === "progress") {
            const d = data as {
              dealId: string;
              dealName: string;
              index: number;
              total: number;
              status: "analyzing" | "done" | "failed";
              mikeyHealth?: string;
              healthFlipped?: boolean;
              error?: string;
            };
            setBulkAnalyzeProgress((prev) => {
              if (!prev) return prev;
              const existingIdx = prev.rows.findIndex((r) => r.dealId === d.dealId);
              const row = {
                dealId: d.dealId,
                dealName: d.dealName,
                status: d.status,
                mikeyHealth: d.mikeyHealth,
                healthFlipped: d.healthFlipped,
                error: d.error,
              };
              const rows = [...prev.rows];
              if (existingIdx >= 0) rows[existingIdx] = row;
              else rows.push(row);
              return {
                ...prev,
                rows,
                current: d.status === "analyzing" ? d.index + 1 : Math.max(prev.current, d.index + 1),
                currentDealName: d.status === "analyzing" ? d.dealName : prev.currentDealName,
              };
            });
          } else if (event === "complete") {
            const d = data as { analyzed: number; failed: number; healthFlips: number };
            setBulkAnalyzeProgress((prev) => prev && { ...prev, summary: d, currentDealName: null });
          } else if (event === "error") {
            const d = data as { error: string };
            console.error("[deals] bulk-analyze stream error:", d.error);
          }
        }
      }

      // Refresh card data so updated Mikey Health pills + lastAnalyzedAt
      // reflect the bulk run.
      await loadDeals();
    } catch (err) {
      console.error("[deals] bulk-analyze error", err);
    } finally {
      setBulkAnalyzing(false);
    }
  };

  // Button-driven path: analyze whatever the user currently has filtered
  // into view. Thin wrapper around runBulkAnalyzeForIds so the same SSE
  // progress flow gets reused from both the manual click and the
  // post-scan auto-trigger in handleScanCalendar.
  const handleBulkAnalyze = () => {
    const ids = filteredDeals.map((d) => d.id);
    void runBulkAnalyzeForIds(ids);
  };

  const handleScanCalendar = async () => {
    if (scanningCalendar) return;
    setScanningCalendar(true);
    setCalendarScanResult(null);
    try {
      const res = await fetch("/api/deals/scan-future-meetings", { method: "POST" });
      if (!res.ok) {
        console.error("[deals] scan-future-meetings failed", res.status);
        return;
      }
      const summary = await res.json();
      setCalendarScanResult(summary);
      if (summary.totalEventsAdded > 0) await loadDeals();

      // If any deals got new meetings, chain into the bulk-analyze SSE
      // endpoint so their Mikey Health + analysis reflect the new
      // calendar evidence. Reuses the live progress banner the user
      // already sees for the manual "Re-analyze (N)" button.
      const needAnalysis: string[] = Array.isArray(summary.dealsNeedingAnalysis)
        ? summary.dealsNeedingAnalysis.filter((d: unknown): d is string => typeof d === "string")
        : [];
      if (needAnalysis.length > 0) {
        void runBulkAnalyzeForIds(needAnalysis);
      }
    } catch (err) {
      console.error("[deals] scan-future-meetings error", err);
    } finally {
      setScanningCalendar(false);
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

      // 3) If there are picked calendar events, write each as a lightweight
      // "meeting" timeline entry and seed any new external attendees as
      // participants. Dedupes via metadata.calendarEventId so a later
      // post-validation enrichDeal pass doesn't double-import them.
      if (importedCalendarEvents.length > 0) {
        const sortedEvents = [...importedCalendarEvents].sort((a, b) => {
          return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        });
        const eventParticipants = new Map<string, { name: string; email: string }>();
        for (const ev of sortedEvents) {
          const attendeeLine = ev.attendees
            .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
            .filter(Boolean)
            .join(", ");
          const body =
            (ev.description ? `${ev.description.trim()}\n\n` : "") +
            (attendeeLine ? `**Attendees:** ${attendeeLine}` : "");
          await fetch(`/api/deals/${deal.id}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "meeting",
              title: ev.title,
              content: body || "(no description)",
              sourceUrl: ev.meetingUrl || ev.eventUrl || undefined,
              entryDate: ev.startsAt,
              metadata: {
                source: "calendar",
                calendarEventId: ev.id,
                attendeeEmails: ev.attendees
                  .map((a) => a.email?.trim().toLowerCase())
                  .filter((e): e is string => !!e),
              },
            }),
          });
          for (const a of ev.attendees) {
            if (!a.email) continue;
            const key = a.email.toLowerCase();
            if (!eventParticipants.has(key)) {
              eventParticipants.set(key, { name: a.name || a.email, email: a.email });
            }
          }
        }
        for (const p of eventParticipants.values()) {
          await fetch(`/api/deals/${deal.id}/participants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: p.name,
              email: p.email,
              role: "unknown",
            }),
          });
        }
      }

      // Phase 4 fusion: attach any selected prior Pre-Call Plans as
      // research_brief timeline entries. Upsert endpoint dedupes by
      // researchId so repeats are safe. Done before navigation so the
      // detail page renders them immediately.
      if (selectedPriorBriefIds.size > 0) {
        const briefsToAttach = priorBriefs.filter((b) => selectedPriorBriefIds.has(b.id));
        for (const b of briefsToAttach) {
          const titleParts: string[] = ["Pre-Call Plan"];
          if (b.companyName) titleParts.push(b.companyName);
          if (b.contactName) titleParts.push(`w/ ${b.contactName}`);
          try {
            await fetch(`/api/deals/${deal.id}/entries/research-brief`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                researchId: b.id,
                title: titleParts.join(" — "),
                preview: b.preview || "Pre-Call Plan",
                sourceUrl: `/pre-call-planning/research?id=${b.id}`,
                entryDate: b.createdAt,
              }),
            });
          } catch (err) {
            console.error("[createDeal] attach prior brief failed:", err);
          }
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
    setImportedCalendarEvents([]);
    setNewDealSourceTab("recorder");
    setPriorBriefs([]);
    setSelectedPriorBriefIds(new Set());
  };

  const filteredDeals = (() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const filtered = deals.filter((d) => {
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (q && !d.name.toLowerCase().includes(q) && !d.companyName.toLowerCase().includes(q)) {
        return false;
      }
      if (healthFilter !== "all") {
        if (healthFilter === "unrated" ? !!d.mikeyHealth : d.mikeyHealth !== healthFilter) {
          return false;
        }
      }
      if (meetingFilter !== "all") {
        const has = !!d.nextMeetingAt;
        if (meetingFilter === "with" && !has) return false;
        if (meetingFilter === "without" && has) return false;
        if (meetingFilter === "this_week") {
          if (!has) return false;
          const diff = new Date(d.nextMeetingAt!).getTime() - now;
          if (diff < 0 || diff > 7 * dayMs) return false;
        }
      }
      if (activityFilter !== "all") {
        const ts = d.lastActivityAt ? new Date(d.lastActivityAt).getTime() : null;
        if (activityFilter === "stale_30" && ts !== null && now - ts < 30 * dayMs) return false;
        if (activityFilter === "stale_30" && ts === null) {
          // No activity ever — count as stale too.
        }
        if (activityFilter === "recent_7") {
          if (ts === null || now - ts > 7 * dayMs) return false;
        }
        if (activityFilter === "never" && ts !== null) return false;
      }
      return true;
    });

    // Pipeline order for the stage sort. Built-ins anchored to
    // mergePipeline so custom stages slot in at the right index.
    const pipelineIndex = new Map(mergePipeline(customStages, archivedBuiltinStages).map((s, i) => [s.value, i]));

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
        // Alphabetical sorts use locale-aware compare with numeric
        // collation so "Acme 2" sorts before "Acme 10". Case-insensitive
        // so a stray uppercase letter doesn't disrupt ordering.
        case "name_az":
          return (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true });
        case "company_az":
          return (a, b) => (a.companyName || "").localeCompare(b.companyName || "", undefined, { sensitivity: "base", numeric: true });
        case "recent":
          return (a, b) => cmpDateDesc(a.updatedAt, b.updatedAt);
        default:
          return () => 0;
      }
    };

    // Each comparator already returns its "natural" direction's
    // output. If the user has flipped the toggle so sortDir differs
    // from the option's natural direction, multiply by -1.
    const applyDir = (cmp: (a: Deal, b: Deal) => number, key: string, dir: "asc" | "desc") => {
      const flip = dir !== NATURAL_DIR[key];
      return flip ? (a: Deal, b: Deal) => -cmp(a, b) : cmp;
    };
    const primary = applyDir(makeComparator(sortBy), sortBy, sortDir);
    const secondary = sortBy2 !== "none" && sortBy2 !== sortBy
      ? applyDir(makeComparator(sortBy2), sortBy2, sortDir2)
      : null;
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
              onClick={handleBulkAnalyze}
              disabled={bulkAnalyzing || filteredDeals.length === 0}
              className="px-3 py-2 border border-pink-200 dark:border-pink-800 text-pink-700 dark:text-pink-300 bg-white dark:bg-gray-800 rounded-lg font-medium text-sm hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-all flex items-center gap-2 disabled:opacity-60"
              title={`Re-run the deal analyzer on each of the ${filteredDeals.length} visible deal${filteredDeals.length === 1 ? "" : "s"}`}
            >
              {bulkAnalyzing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing…
                </>
              ) : (
                <>🧠 Re-analyze ({filteredDeals.length})</>
              )}
            </button>
            <button
              onClick={handleScanCalendar}
              disabled={scanningCalendar}
              className="px-3 py-2 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 bg-white dark:bg-gray-800 rounded-lg font-medium text-sm hover:bg-green-50 dark:hover:bg-green-900/20 transition-all flex items-center gap-2 disabled:opacity-60"
              title="Scan the next 90 days of your calendar and add new future meetings to every active deal"
            >
              {scanningCalendar ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning…
                </>
              ) : (
                <>📅 Scan Calendar (90d)</>
              )}
            </button>
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

        {bulkAnalyzeProgress && (
          <div className="mb-4 p-3 rounded-lg border border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/20 text-sm flex items-start justify-between gap-3">
            <div className="text-gray-700 dark:text-gray-200 flex-1 min-w-0">
              <div className="font-medium mb-0.5 flex items-center gap-2">
                {bulkAnalyzeProgress.summary
                  ? <>🧠 Bulk analysis complete</>
                  : <>🧠 Re-analyzing deals…</>}
                <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                  {bulkAnalyzeProgress.summary
                    ? `${bulkAnalyzeProgress.summary.analyzed} analyzed${bulkAnalyzeProgress.summary.failed ? ` · ${bulkAnalyzeProgress.summary.failed} failed` : ""}${bulkAnalyzeProgress.summary.healthFlips ? ` · ${bulkAnalyzeProgress.summary.healthFlips} health change${bulkAnalyzeProgress.summary.healthFlips === 1 ? "" : "s"}` : ""}`
                    : `${bulkAnalyzeProgress.current} of ${bulkAnalyzeProgress.total}${bulkAnalyzeProgress.currentDealName ? ` · ${bulkAnalyzeProgress.currentDealName}` : ""}`}
                </span>
              </div>
              {/* Live progress bar */}
              <div className="h-1.5 bg-pink-100 dark:bg-pink-900/40 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-pink-500 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.round((bulkAnalyzeProgress.current / Math.max(1, bulkAnalyzeProgress.total)) * 100))}%` }}
                />
              </div>
              {bulkAnalyzeProgress.rows.length > 0 && (
                <ul className="mt-1 text-xs text-gray-600 dark:text-gray-300 space-y-0.5 max-h-40 overflow-y-auto">
                  {bulkAnalyzeProgress.rows.map((r) => (
                    <li key={r.dealId} className="flex items-center gap-2">
                      <span className="w-4 flex-shrink-0 text-center">
                        {r.status === "done" ? "✓" : r.status === "failed" ? "✗" : "…"}
                      </span>
                      <a href={`/deals/${r.dealId}`} className="text-pink-700 dark:text-pink-300 hover:underline truncate">{r.dealName}</a>
                      {r.status === "done" && r.mikeyHealth && (
                        <span className="text-[10px] uppercase font-medium text-gray-500 dark:text-gray-400">
                          {r.mikeyHealth}{r.healthFlipped ? " ⟵ changed" : ""}
                        </span>
                      )}
                      {r.status === "failed" && r.error && (
                        <span className="text-[11px] text-red-600 dark:text-red-300 truncate">{r.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {bulkAnalyzeProgress.summary && (
              <button
                onClick={() => setBulkAnalyzeProgress(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 flex-shrink-0"
                title="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {calendarScanResult && (
          <div className="mb-4 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-sm flex items-start justify-between gap-3">
            <div className="text-gray-700 dark:text-gray-200">
              <div className="font-medium mb-0.5">Calendar sweep complete</div>
              <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                {!calendarScanResult.hasCalendar ? (
                  <div className="italic">Calendar not connected — connect Google Calendar to use this.</div>
                ) : (
                  <>
                    <div>
                      Scanned {calendarScanResult.dealsScanned} active deal{calendarScanResult.dealsScanned === 1 ? "" : "s"} against the next 90 days of your calendar.{" "}
                      Added <strong>{calendarScanResult.totalEventsAdded}</strong> new future meeting{calendarScanResult.totalEventsAdded === 1 ? "" : "s"}.
                      {calendarScanResult.totalEventsAdded > 0 && (
                        <span className="text-pink-700 dark:text-pink-300"> Re-analyzing affected deals…</span>
                      )}
                    </div>
                    {calendarScanResult.perDeal.length > 0 && (
                      <ul className="mt-1 list-disc list-inside text-gray-600 dark:text-gray-300">
                        {calendarScanResult.perDeal.slice(0, 6).map((d) => (
                          <li key={d.dealId}>
                            <a href={`/deals/${d.dealId}`} className="text-green-700 dark:text-green-300 hover:underline">{d.dealName}</a>: +{d.added}
                            {d.skipped > 0 && <span className="text-gray-400"> ({d.skipped} already on timeline)</span>}
                          </li>
                        ))}
                        {calendarScanResult.perDeal.length > 6 && (
                          <li className="text-gray-400">+{calendarScanResult.perDeal.length - 6} more</li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => setCalendarScanResult(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 flex-shrink-0"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

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
                    Calendar (30d back, 7d forward): scanned {discoverResult.calendar.scanned}, {discoverResult.calendar.potentials} new potential,{" "}
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
            onChange={(e) => {
              const next = e.target.value;
              setSortBy(next);
              setSortDir(NATURAL_DIR[next] || "desc");
            }}
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
            <option value="name_az">Deal name (A→Z)</option>
            <option value="company_az">Company name (A→Z)</option>
          </select>
          <SortDirButton dir={sortDir} onToggle={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          Then by:
          <select
            value={sortBy2}
            onChange={(e) => {
              const next = e.target.value;
              setSortBy2(next);
              setSortDir2(NATURAL_DIR[next] || "desc");
            }}
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
            <option value="name_az" disabled={sortBy === "name_az"}>Deal name (A→Z)</option>
            <option value="company_az" disabled={sortBy === "company_az"}>Company name (A→Z)</option>
          </select>
          {sortBy2 !== "none" && (
            <SortDirButton dir={sortDir2} onToggle={() => setSortDir2((d) => (d === "asc" ? "desc" : "asc"))} />
          )}
        </label>
        <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden ml-auto">
          <button
            type="button"
            onClick={() => setLayout("grid")}
            className={`px-2 py-1.5 text-sm transition-colors ${
              layout === "grid"
                ? "bg-purple-600 text-white"
                : "text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
            title="2-column grid"
            aria-label="2-column grid"
          >
            ▦
          </button>
          <button
            type="button"
            onClick={() => setLayout("list")}
            className={`px-2 py-1.5 text-sm transition-colors ${
              layout === "list"
                ? "bg-purple-600 text-white"
                : "text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
            title="Ranked single-column list with extra detail"
            aria-label="Single-column list"
          >
            ☰
          </button>
        </div>
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
          {mergePipeline(customStages, archivedBuiltinStages).map((s) => {
            // Popover key namespaces built-ins (by stage value) and
            // customs (by customId) into the same editingStageId state
            // — same popover dismiss / single-open behavior either way.
            const popoverKey = s.builtin ? `builtin:${s.value}` : s.customId;
            const popoverOpen = editingStageId === popoverKey;
            return (
            <span key={s.value} className="relative inline-flex items-center group/stage">
              <button
                onClick={() => setStageFilter(s.value)}
                className={`pl-2.5 pr-1 py-1 rounded-l-full text-xs font-medium transition-colors ${stageFilter === s.value ? "bg-gray-900 text-white" : `${s.color} hover:opacity-80`}`}
                title="Click to filter"
              >
                {s.label}
              </button>
              <button
                onClick={() => {
                  setEditingStageId(popoverKey ?? null);
                  setEditStageLabel(s.label);
                  setEditStageColor(s.color);
                  const cust = !s.builtin ? customStages.find((c) => c.id === s.customId) : null;
                  setEditStageInsertAfter(cust?.insertAfter || "");
                }}
                className={`pl-1 pr-2 py-1 rounded-r-full text-xs font-medium transition-colors ${stageFilter === s.value ? "bg-gray-900 text-white opacity-70 hover:opacity-100" : `${s.color} opacity-50 group-hover/stage:opacity-100 hover:opacity-100`}`}
                title={s.builtin ? "Archive this built-in stage" : "Edit / archive this stage"}
                aria-label={s.builtin ? `Archive ${s.label}` : `Edit ${s.label}`}
              >
                ✎
              </button>
              {popoverOpen && s.builtin && (
                <div className="absolute left-0 top-full mt-2 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Built-in stage
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    <strong className="text-gray-700 dark:text-gray-200">{s.label}</strong> is built-in — its label and color can&apos;t be edited. Archive to hide it from the picker. Existing deals on this stage keep their pill.
                  </p>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={async () => {
                        await fetch(`/api/deals/stages/builtin/${s.value}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: true }),
                        });
                        setArchivedBuiltinStages((prev) => Array.from(new Set([...prev, s.value])));
                        if (stageFilter === s.value) setStageFilter("all");
                        setEditingStageId(null);
                      }}
                      className="text-xs text-red-600 dark:text-red-300 hover:underline font-medium"
                    >
                      Archive stage
                    </button>
                    <button
                      onClick={() => setEditingStageId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {popoverOpen && !s.builtin && (
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
                        // Keep the row in customStages but flip archived=true so
                        // the Archived restore row can surface it.
                        const archivedId = editingStageId.replace(/^builtin:/, "");
                        setCustomStages((prev) => prev.map((c) => c.id === archivedId ? { ...c, archived: true } : c));
                        if (stageFilter !== "all") {
                          const archived = customStages.find((c) => c.id === archivedId);
                          if (archived && stageFilter === archived.value) setStageFilter("all");
                        }
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
            );
          })}
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
        {/* Archived stages restore row — only shows when there are any
            archived built-ins or customs. Restore returns the stage to
            the chip row in its original pipeline position. */}
        {(() => {
          const archivedCustoms = customStages.filter((c) => c.archived);
          const archivedBuiltinDetails = archivedBuiltinStages
            .map((v) => DEAL_STAGES.find((b) => b.value === v))
            .filter((b): b is (typeof DEAL_STAGES)[number] => !!b);
          if (archivedCustoms.length === 0 && archivedBuiltinDetails.length === 0) return null;
          return (
            <div className="flex items-center gap-2 mb-3 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <span className="uppercase tracking-wider font-medium">Archived:</span>
              {archivedBuiltinDetails.map((b) => (
                <button
                  key={`ab-${b.value}`}
                  onClick={async () => {
                    await fetch(`/api/deals/stages/builtin/${b.value}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ archived: false }),
                    });
                    setArchivedBuiltinStages((prev) => prev.filter((v) => v !== b.value));
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity ${b.color}`}
                  title="Click to restore"
                >
                  {b.label}
                  <span className="text-gray-500">↩</span>
                </button>
              ))}
              {archivedCustoms.map((c) => (
                <button
                  key={`ac-${c.id}`}
                  onClick={async () => {
                    const res = await fetch(`/api/deals/stages/${c.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ archived: false }),
                    });
                    if (res.ok) {
                      const d = await res.json();
                      setCustomStages((prev) => prev.map((x) => x.id === d.stage.id ? d.stage : x));
                    }
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity ${c.color}`}
                  title="Click to restore"
                >
                  {c.label}
                  <span className="text-gray-500">↩</span>
                </button>
              ))}
            </div>
          );
        })()}
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

        {/* Health / Meeting / Activity filters — sit alongside status
            so the user can quickly slice by deal-momentum signals. */}
        <div className="flex items-center gap-3 mb-6 flex-wrap text-sm">
          <span className="text-gray-500 dark:text-gray-400 text-xs font-medium uppercase tracking-wider">Health:</span>
          <FilterPill active={healthFilter === "all"} onClick={() => setHealthFilter("all")}>All</FilterPill>
          {MIKEY_HEALTH_LEVELS.map((h) => (
            <FilterPill
              key={h.value}
              active={healthFilter === h.value}
              onClick={() => setHealthFilter(h.value)}
              colorWhenIdle={h.color}
            >
              {h.emoji} {h.label}
            </FilterPill>
          ))}
          <FilterPill active={healthFilter === "unrated"} onClick={() => setHealthFilter("unrated")}>
            Unrated
          </FilterPill>

          <span className="text-gray-500 dark:text-gray-400 text-xs font-medium uppercase tracking-wider ml-3">Meeting:</span>
          <FilterPill active={meetingFilter === "all"} onClick={() => setMeetingFilter("all")}>All</FilterPill>
          <FilterPill active={meetingFilter === "with"} onClick={() => setMeetingFilter("with")}>📅 Has next</FilterPill>
          <FilterPill active={meetingFilter === "this_week"} onClick={() => setMeetingFilter("this_week")}>This week</FilterPill>
          <FilterPill active={meetingFilter === "without"} onClick={() => setMeetingFilter("without")}>⚠ None</FilterPill>

          <span className="text-gray-500 dark:text-gray-400 text-xs font-medium uppercase tracking-wider ml-3">Activity:</span>
          <FilterPill active={activityFilter === "all"} onClick={() => setActivityFilter("all")}>All</FilterPill>
          <FilterPill active={activityFilter === "recent_7"} onClick={() => setActivityFilter("recent_7")}>Last 7d</FilterPill>
          <FilterPill active={activityFilter === "stale_30"} onClick={() => setActivityFilter("stale_30")}>Stale 30d+</FilterPill>
          <FilterPill active={activityFilter === "never"} onClick={() => setActivityFilter("never")}>No activity</FilterPill>
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
          <div className={layout === "list" ? "flex flex-col gap-3" : "grid grid-cols-1 sm:grid-cols-2 gap-4"}>
            {filteredDeals.map((deal) => {
              const stageInfo = resolveStage(deal.stage, customStages);
              const statusInfo = getStatusInfo(deal.status);
              const pipeline = mergePipeline(customStages, archivedBuiltinStages);
              const patchDeal = async (patch: { stage?: string; status?: string; dealValue?: number | null; projectedCloseDate?: string | null }) => {
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
              const parsedAnalysis = parseDealAnalysis(deal.lastAnalysis);
              const showRightRail = layout === "list";
              return (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className={`block text-left bg-white dark:bg-gray-800 border rounded-xl p-3 hover:shadow-md transition-all group ${deal.status === "potential" ? "border-purple-300 border-dashed hover:border-purple-500" : "border-gray-200 dark:border-gray-700 hover:border-purple-300"}`}
                >
                  <div className={showRightRail ? "flex items-start gap-4" : ""}>
                    <div className={showRightRail ? "min-w-0 flex-1" : ""}>
                  {/* Title row — title + companyName inline. The Stage
                      chip used to sit on the right edge here; in the
                      new layout it lives in the metadata row next to
                      Status so the right side of the card is free for
                      analysis widgets. */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1 flex items-baseline gap-2">
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
                          className="self-center accent-purple-600 cursor-pointer flex-shrink-0"
                          title="Select for bulk action"
                        />
                      )}
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{deal.name}</h3>
                      <span className="text-sm text-gray-400 dark:text-gray-500 truncate">· {deal.companyName}</span>
                    </div>
                  </div>
                  {/* Metadata row — Stage + Status + counts + value +
                      health + last activity + next meeting, all on one
                      line that wraps gracefully on narrow screens. */}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    <InlinePillSelect
                      currentValue={stageInfo.value}
                      currentLabel={stageInfo.label}
                      currentColor={stageInfo.color}
                      options={pipeline.map((p) => ({ value: p.value, label: p.label, color: p.color }))}
                      onChange={(value) => patchDeal({ stage: value })}
                    />
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
                    {(() => {
                      const h = getHealthInfo(deal.mikeyHealth);
                      if (!h) return null;
                      return (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${h.color}`}
                          title="Mikey Health — set on last deal analysis"
                        >
                          {h.emoji} {h.label}
                        </span>
                      );
                    })()}
                    {deal.lastActivityAt ? (
                      <span className="text-gray-500 dark:text-gray-400">· Last activity {formatRelative(deal.lastActivityAt)}</span>
                    ) : (
                      <span className="text-gray-400 italic">· No activity yet</span>
                    )}
                    {deal.nextMeetingAt ? (
                      <span className="text-purple-700 dark:text-purple-300 font-medium">· 📅 {formatNextMeeting(deal.nextMeetingAt)}</span>
                    ) : (
                      (deal.status === "active" || deal.status === "stalled") ? (
                        <span className="text-amber-600 dark:text-amber-400">· ⚠ No upcoming meeting</span>
                      ) : null
                    )}
                  </div>
                  {/* Participant chips — surface WHO is on the deal, not
                      just a count. Cap at 5 visible; overflow shows as
                      "+N more". Role-prioritized so decision-makers
                      surface first. */}
                  {deal.participants && deal.participants.length > 0 && (() => {
                    const sorted = deal.participants.slice().sort(
                      (a, b) => (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99)
                    );
                    const visible = sorted.slice(0, 5);
                    const overflow = sorted.length - visible.length;
                    return (
                      <div className="flex items-center gap-1 flex-wrap mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {visible.map((p) => {
                          const roleInfo = getRoleInfo(p.role);
                          const label = participantChipLabel(p);
                          const tooltip = `${label}${p.title ? ` — ${p.title}` : ""}${p.email ? ` · ${p.email}` : ""} · ${roleInfo.label}`;
                          return (
                            <span
                              key={p.id}
                              title={tooltip}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${roleInfo.color} border-current/20 max-w-[160px] truncate`}
                            >
                              {label}
                            </span>
                          );
                        })}
                        {overflow > 0 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
                            title={sorted.slice(5).map((p) => participantChipLabel(p)).join(", ")}
                          >
                            +{overflow} more
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {deal.status === "potential" && (
                    <div className="flex items-center gap-2 mt-1.5" onClick={(e) => e.stopPropagation()}>
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
                  {/* Extended details — list-only row with forecast + close
                      dates + source + notes so the wider card layout has
                      something to chew on. Last activity / next meeting
                      moved into the main metadata row above to compress
                      the card. */}
                  {layout === "list" && (
                    <div
                      className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-4 flex-wrap border-t border-gray-100 dark:border-gray-700 pt-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex items-center gap-1.5">
                        <span className="text-gray-400">Size:</span>
                        <span className="text-gray-500">$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={deal.dealValue != null ? deal.dealValue.toLocaleString("en-US") : ""}
                          key={`size-${deal.dealValue ?? "empty"}`}
                          onClick={(e) => e.preventDefault()}
                          onInput={(e) => {
                            const el = e.currentTarget;
                            const digits = el.value.replace(/[^\d]/g, "");
                            el.value = digits ? Number(digits).toLocaleString("en-US") : "";
                          }}
                          onBlur={(e) => {
                            const digits = e.target.value.replace(/[^\d]/g, "");
                            const next = digits === "" ? null : Math.max(0, parseInt(digits, 10));
                            if (next !== (deal.dealValue ?? null)) {
                              patchDeal({ dealValue: next });
                            }
                          }}
                          placeholder="—"
                          className="w-20 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5 text-gray-700 dark:text-gray-200 font-medium"
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-gray-400">Projected close:</span>
                        <input
                          type="date"
                          value={deal.projectedCloseDate ? deal.projectedCloseDate.split("T")[0] : ""}
                          onClick={(e) => e.preventDefault()}
                          onChange={(e) => patchDeal({ projectedCloseDate: e.target.value || null })}
                          className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5 text-gray-700 dark:text-gray-200"
                        />
                      </label>
                      {(deal.status === "closed_won" || deal.status === "closed_lost") && (deal as Deal & { closeDate?: string | null }).closeDate && (
                        <span>
                          <span className="text-gray-400">Closed:</span> <span className="text-gray-700 dark:text-gray-200">{new Date((deal as Deal & { closeDate: string }).closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        </span>
                      )}
                      <span>
                        <span className="text-gray-400">Created:</span> <span className="text-gray-700 dark:text-gray-200">{new Date(deal.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      </span>
                      {deal.source && (
                        <span className="text-purple-600 dark:text-purple-300">
                          Auto-detected · {deal.source === "calendar" ? "Calendar" : "Recorder"}
                        </span>
                      )}
                    </div>
                  )}
                  </div>
                  {showRightRail && (
                    <div
                      className="w-72 flex-shrink-0 flex flex-col gap-2 border-l border-gray-100 dark:border-gray-700 pl-4 self-stretch"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AnalysisWidget
                        label="Current State"
                        section={parsedAnalysis.currentState}
                        emptyHint={deal.lastAnalysis ? null : "Run analysis to populate"}
                      />
                      <AnalysisWidget
                        label="Last Meaningful Interaction"
                        section={parsedAnalysis.lastInteraction}
                        emptyHint={
                          deal.lastAnalysis
                            ? "Re-analyze to populate this section"
                            : "Run analysis to populate"
                        }
                      />
                      <AnalysisWidget
                        label="Next Best Action"
                        section={parsedAnalysis.nextBestAction}
                        emptyHint={deal.lastAnalysis ? null : "Run analysis to populate"}
                      />
                    </div>
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

            {/* Source picker tabs: meeting recorder vs Google Calendar */}
            <div className="mb-3 flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setNewDealSourceTab("recorder")}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  newDealSourceTab === "recorder"
                    ? "border-purple-500 text-purple-700 dark:text-purple-300"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                🎙️ Meeting Recorder
              </button>
              <button
                type="button"
                onClick={() => setNewDealSourceTab("calendar")}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  newDealSourceTab === "calendar"
                    ? "border-purple-500 text-purple-700 dark:text-purple-300"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                📅 Calendar
              </button>
            </div>

            <div className="mb-4" hidden={newDealSourceTab !== "recorder"}>
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

            <div className="mb-4" hidden={newDealSourceTab !== "calendar"}>
              <CalendarEventPicker
                onAddEvents={(picked: CalendarPickerEvent[]) => {
                  setImportedCalendarEvents((prev) => {
                    const seen = new Set(prev.map((e) => e.id));
                    const merged = [...prev];
                    for (const ev of picked) {
                      if (seen.has(ev.id)) continue;
                      seen.add(ev.id);
                      merged.push({
                        id: ev.id,
                        title: ev.title,
                        startsAt: ev.startsAt,
                        description: ev.description,
                        meetingUrl: ev.meetingUrl,
                        eventUrl: ev.eventUrl,
                        inferredCompany: ev.inferredCompany,
                        attendees: ev.attendees.map((a) => ({ email: a.email, name: a.name })),
                      });
                    }
                    return merged;
                  });
                  // Pre-fill company/deal name from the picked events if
                  // the user hasn't already typed them. Mirrors the
                  // recorder-tab behavior so both sources feed into the
                  // same suggest-name flow.
                  const inferred = picked.find((e) => e.inferredCompany)?.inferredCompany;
                  if (inferred) {
                    setNewDealCompany((prev) => prev.trim() ? prev : inferred.name);
                  }
                  setSuggestingName(true);
                  fetch("/api/deals/suggest-name", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      calls: [],
                      events: picked.map((ev) => ({
                        title: ev.title,
                        date: ev.startsAt,
                        description: ev.description,
                        attendees: ev.attendees,
                      })),
                    }),
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

            {importedCalendarEvents.length > 0 && (
              <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-green-900 dark:text-green-200">
                    📅 {importedCalendarEvents.length} calendar event{importedCalendarEvents.length === 1 ? "" : "s"} attached
                  </p>
                  <button
                    onClick={() => setImportedCalendarEvents([])}
                    className="text-xs text-green-700 dark:text-green-300 hover:text-green-900"
                  >
                    Clear all
                  </button>
                </div>
                <ul className="space-y-1">
                  {[...importedCalendarEvents]
                    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
                    .map((ev, idx) => (
                      <li key={ev.id} className="flex items-center justify-between gap-2 text-xs text-green-800 dark:text-green-200">
                        <span className="truncate">
                          <span className="text-green-600 dark:text-green-300 mr-1.5">
                            {new Date(ev.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                          <span className="font-medium">{ev.title}</span>
                          <span className="text-green-700 dark:text-green-400"> · {ev.attendees.length} attendee{ev.attendees.length === 1 ? "" : "s"}</span>
                        </span>
                        <button
                          onClick={() => setImportedCalendarEvents((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-green-600 hover:text-red-500 flex-shrink-0"
                          aria-label="Remove event"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                </ul>
                <p className="text-xs text-green-700 dark:text-green-400 mt-2">
                  Each event becomes a meeting entry on the timeline. External attendees become deal participants.
                </p>
              </div>
            )}

            {priorBriefs.length > 0 && (
              <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-purple-900 dark:text-purple-200">
                    🔬 {priorBriefs.length} prior Pre-Call Plan{priorBriefs.length === 1 ? "" : "s"} for this prospect
                  </p>
                  <div className="text-xs text-purple-700 dark:text-purple-300 flex items-center gap-2">
                    <button
                      onClick={() => setSelectedPriorBriefIds(new Set(priorBriefs.map((b) => b.id)))}
                      className="hover:underline"
                    >
                      Select all
                    </button>
                    <span className="text-purple-300">·</span>
                    <button
                      onClick={() => setSelectedPriorBriefIds(new Set())}
                      className="hover:underline"
                    >
                      Select none
                    </button>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {priorBriefs.map((b) => {
                    const checked = selectedPriorBriefIds.has(b.id);
                    return (
                      <li key={b.id}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedPriorBriefIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(b.id)) next.delete(b.id);
                                else next.add(b.id);
                                return next;
                              });
                            }}
                            className="mt-0.5 accent-purple-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs flex items-center gap-2 flex-wrap">
                              <span className="text-purple-700 dark:text-purple-300 font-medium">
                                {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                              <span className="text-purple-900 dark:text-purple-100 font-medium">{b.companyName}</span>
                              {b.contactName && (
                                <span className="text-purple-700 dark:text-purple-300">w/ {b.contactName}{b.contactTitle ? `, ${b.contactTitle}` : ""}</span>
                              )}
                              <a
                                href={`/pre-call-planning/research?id=${b.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] text-purple-600 hover:underline"
                              >
                                open ↗
                              </a>
                            </div>
                            {b.preview && (
                              <div className="text-[11px] text-purple-700/80 dark:text-purple-300/80 line-clamp-2 mt-0.5">
                                {b.preview}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-purple-700 dark:text-purple-400 mt-2">
                  Selected plans become Pre-Call Plan timeline entries on the new deal.
                </p>
              </div>
            )}

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
                {(() => {
                  if (creating) {
                    return (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        Creating...
                      </span>
                    );
                  }
                  const total = importedCalls.length + importedCalendarEvents.length;
                  if (total === 0) return "Create Deal";
                  // Build a short pluralized summary covering both sources
                  // so the button label tracks what's actually been picked.
                  const parts: string[] = [];
                  if (importedCalls.length > 0) parts.push(`${importedCalls.length} call${importedCalls.length === 1 ? "" : "s"}`);
                  if (importedCalendarEvents.length > 0) parts.push(`${importedCalendarEvents.length} event${importedCalendarEvents.length === 1 ? "" : "s"}`);
                  return `Create Deal from ${parts.join(" + ")}`;
                })()}
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

// Right-rail widget on each deal card showing one section of the
// latest deal analysis (Current State / Last Meaningful Interaction /
// Next Best Action). Two lines clipped in the card; hover surfaces a
// popover with the full section content. Renders a faded "Run / Re-
// analyze to populate" hint when the section is missing.
function AnalysisWidget({
  label,
  section,
  emptyHint,
}: {
  label: string;
  section: { headline: string; full: string } | null;
  emptyHint: string | null;
}) {
  return (
    <div className="group/widget relative text-[11px] leading-snug">
      <div className="font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide text-[10px] mb-0.5">
        {label}
      </div>
      {section ? (
        <>
          <div className="text-gray-700 dark:text-gray-200 line-clamp-2">
            {section.headline}
          </div>
          {/* Hover popover — full section content. Positioned to the
              left of the rail so it doesn't fall off the right edge
              of the page on narrow viewports. */}
          <div className="hidden group-hover/widget:block absolute right-0 top-full mt-1 z-30 w-96 max-w-[80vw] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
              {label}
            </div>
            <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap max-h-72 overflow-y-auto">
              {section.full}
            </div>
          </div>
        </>
      ) : (
        <div className="text-gray-300 dark:text-gray-600 italic">
          {emptyHint || "—"}
        </div>
      )}
    </div>
  );
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

function FilterPill({
  active,
  onClick,
  children,
  colorWhenIdle,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  colorWhenIdle?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white"
          : colorWhenIdle
          ? `${colorWhenIdle} hover:opacity-80`
          : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
    >
      {children}
    </button>
  );
}

function SortDirButton({ dir, onToggle }: { dir: "asc" | "desc"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus:ring-2 focus:ring-purple-500 focus:outline-none"
      title={dir === "desc" ? "Sorted highest / newest / soonest first — click to flip" : "Sorted lowest / oldest / latest first — click to flip"}
    >
      {dir === "desc" ? "↓" : "↑"}
    </button>
  );
}
