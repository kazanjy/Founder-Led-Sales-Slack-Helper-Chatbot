"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import { DealExecutionReview } from "@/components/DealExecutionReview";
import { DEAL_STAGES, getStageInfo } from "@/lib/deals/constants";

/**
 * Cross-deal task inbox — every upcoming / overdue deal task in one
 * linkable place, grouped Overdue → Due today → Upcoming, with inline
 * disposition: 🚀 Execute now (preview overlay, edit, send-as-you),
 * ✓ Done, ✕ Dismiss. Linked from the deals toolbar as ⚡ Tasks.
 */

interface TaskDeal {
  id: string;
  name: string;
  companyName: string | null;
  status: string;
  stage: string;
  slackChannelId: string | null;
  slackChannelName: string | null;
  lastActivityAt: string | null;
}

interface InboxTask {
  id: string;
  dealId: string;
  title: string;
  rationale: string | null;
  status: string;
  dueAt: string | null;
  executeVia: string | null;
  draftMessage: string | null;
  executedAt: string | null;
  resolvedAt: string | null;
  deal: TaskDeal;
}

export default function DealTasksInboxPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <DealTasksInboxInner />
    </Suspense>
  );
}

function DealTasksInboxInner() {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState<InboxTask[]>([]);
  const [resolved, setResolved] = useState<InboxTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Filters + sort. ?due=past presets the due filter (execution-review
  // deep link).
  const [filterName, setFilterName] = useState("");
  const [filterStage, setFilterStage] = useState("all");
  const [filterType, setFilterType] = useState<"all" | "executable" | "non_executable">("all");
  const [filterDue, setFilterDue] = useState<"all" | "past" | "scheduled" | "undated">(() => {
    const due = searchParams.get("due");
    if (due === "past") return "past";
    if (due === "scheduled" || due === "future") return "scheduled";
    if (due === "undated") return "undated";
    return "all";
  });
  const [sortBy, setSortBy] = useState<"due" | "stage" | "activity">("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Execute overlay state (same flow as the deal page card).
  const [executeTask, setExecuteTask] = useState<InboxTask | null>(null);
  const [executeDraft, setExecuteDraft] = useState("");
  const [executeDue, setExecuteDue] = useState("");
  const [executeLoadingDraft, setExecuteLoadingDraft] = useState(false);
  const [executeSending, setExecuteSending] = useState(false);
  const [executeSaving, setExecuteSaving] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // ISO → the local value a <input type="datetime-local"> expects.
  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/deal-tasks");
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setOpen(Array.isArray(data.open) ? data.open : []);
        setResolved(Array.isArray(data.resolved) ? data.resolved : []);
      }
    } catch { /* keep last */ }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const patchTask = async (t: InboxTask, status: "done" | "dismissed") => {
    setBusyId(t.id);
    try {
      await fetch(`/api/deals/${t.dealId}/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const openExecuteOverlay = async (t: InboxTask) => {
    setExecuteTask(t);
    setExecuteError(null);
    setExecuteDraft(t.draftMessage || "");
    setExecuteDue(toLocalInput(t.dueAt));
    if (!t.draftMessage) {
      setExecuteLoadingDraft(true);
      try {
        const res = await fetch(`/api/deals/${t.dealId}/tasks/${t.id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || data?.error || "Draft generation failed");
        setExecuteDraft(data?.draft || "");
        // Drafting persists the message (and upgrades the task to
        // Slack-executable) — refresh the rows behind the overlay.
        load();
      } catch (err) {
        setExecuteError(err instanceof Error ? err.message : "Draft generation failed");
      } finally {
        setExecuteLoadingDraft(false);
      }
    }
  };

  const regenerateExecuteDraft = async () => {
    if (!executeTask) return;
    setExecuteLoadingDraft(true);
    setExecuteError(null);
    try {
      const res = await fetch(`/api/deals/${executeTask.dealId}/tasks/${executeTask.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || data?.error || "Draft generation failed");
      setExecuteDraft(data?.draft || "");
      load();
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Draft generation failed");
    } finally {
      setExecuteLoadingDraft(false);
    }
  };

  // Save the overlay's edits (message + due time) without sending.
  const saveExecuteEdits = async () => {
    if (!executeTask || executeSaving) return;
    setExecuteSaving(true);
    setExecuteError(null);
    try {
      const res = await fetch(`/api/deals/${executeTask.dealId}/tasks/${executeTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftMessage: executeDraft,
          dueAt: executeDue ? new Date(executeDue).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      setExecuteTask(null);
      await load();
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setExecuteSaving(false);
    }
  };

  const sendExecuteDraft = async () => {
    if (!executeTask || !executeDraft.trim()) return;
    setExecuteSending(true);
    setExecuteError(null);
    try {
      const res = await fetch(`/api/deals/${executeTask.dealId}/tasks/${executeTask.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: executeDraft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const reasonText: Record<string, string> = {
          no_channel: "No Slack channel is linked to this deal — open the deal to attach one.",
          no_draft: "The message is empty.",
          send_failed: "Slack rejected the send — check the channel link and try again.",
          forbidden: "Only the deal owner can send as themselves.",
        };
        throw new Error(reasonText[data?.reason] || data?.error || "Execution failed");
      }
      setExecuteTask(null);
      setExecuteDraft("");
      await load();
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuteSending(false);
    }
  };

  const now = Date.now();
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(24, 0, 0, 0);

  const stageRank = useMemo(
    () => new Map(DEAL_STAGES.map((s, i) => [s.value as string, i])),
    []
  );

  const filtered = useMemo(() => {
    const q = filterName.trim().toLowerCase();
    return open.filter((t) => {
      if (q) {
        const hay = `${t.deal.companyName || ""} ${t.deal.name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterStage !== "all" && t.deal.stage !== filterStage) return false;
      if (filterType === "executable" && t.executeVia !== "slack_channel") return false;
      if (filterType === "non_executable" && t.executeVia === "slack_channel") return false;
      const past = !!t.dueAt && new Date(t.dueAt).getTime() < now;
      if (filterDue === "past" && !past) return false;
      if (filterDue === "scheduled" && (!t.dueAt || past)) return false;
      if (filterDue === "undated" && t.dueAt) return false;
      return true;
    });
  }, [open, filterName, filterStage, filterType, filterDue, now]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "due") {
      // Soonest first; undated sink to the end (they never ping).
      list.sort(
        (a, b) =>
          (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) -
          (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)
      );
    } else if (sortBy === "stage") {
      list.sort(
        (a, b) =>
          (stageRank.get(a.deal.stage) ?? 99) - (stageRank.get(b.deal.stage) ?? 99) ||
          (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)
      );
    } else if (sortBy === "activity") {
      // Stalest deal first — the inbox doubles as a "who needs me"
      // list, and silence is the signal.
      list.sort(
        (a, b) =>
          (a.deal.lastActivityAt ? new Date(a.deal.lastActivityAt).getTime() : 0) -
          (b.deal.lastActivityAt ? new Date(b.deal.lastActivityAt).getTime() : 0)
      );
    }
    if (sortDir === "desc") list.reverse();
    return list;
  }, [filtered, sortBy, sortDir, stageRank]);

  const overdue = sorted.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now);
  const dueToday = sorted.filter(
    (t) => t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt) < startOfTomorrow
  );
  const upcoming = sorted.filter(
    (t) => !t.dueAt || new Date(t.dueAt) >= startOfTomorrow
  );
  const filtersActive =
    filterName.trim() !== "" || filterStage !== "all" || filterType !== "all" || filterDue !== "all";

  const fmtDue = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "no date";

  const TaskRow = ({ t }: { t: InboxTask }) => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-start gap-3">
      <span className="shrink-0 mt-0.5" title={t.status}>
        {t.status === "pinged" ? "⚡" : "🕒"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            href={`/deals/${t.dealId}`}
            className="text-xs font-semibold text-purple-700 dark:text-purple-300 hover:underline shrink-0"
          >
            {t.deal.companyName || t.deal.name}
          </Link>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${getStageInfo(t.deal.stage).color}`}>
            {getStageInfo(t.deal.stage).label}
          </span>
          <span className="text-sm text-gray-900 dark:text-gray-100">{t.title}</span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          due {fmtDue(t.dueAt)}
          {t.deal.lastActivityAt &&
            ` · deal active ${fmtDue(t.deal.lastActivityAt)}`}
          {t.executeVia === "slack_channel" &&
            ` · 💬 ${t.deal.slackChannelName ? `#${t.deal.slackChannelName}` : "via Slack"}`}
          {t.status === "pinged" && " · pinged, awaiting your go"}
        </div>
        {t.rationale && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 border-l-2 border-purple-200 dark:border-purple-800 pl-2 line-clamp-2">
            {t.rationale}
          </div>
        )}
        {t.draftMessage && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 border-l-2 border-green-200 dark:border-green-800 pl-2 line-clamp-2" title="Message loaded and ready to send">
            💬 {t.draftMessage}
          </div>
        )}
      </div>
      <span className="shrink-0 flex items-center gap-2.5 text-xs pt-0.5">
        {t.executeVia === "slack_channel" ? (
          <>
            <button
              type="button"
              onClick={() => openExecuteOverlay(t)}
              disabled={busyId === t.id}
              className="text-purple-600 dark:text-purple-300 hover:underline font-medium disabled:opacity-50"
              title="Preview the message and send it into the linked Slack channel as you"
            >
              🚀 Execute
            </button>
            <button
              type="button"
              onClick={() => openExecuteOverlay(t)}
              disabled={busyId === t.id}
              className="text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 disabled:opacity-50"
              title="Edit the message and due time — redraft, reschedule, save for later"
            >
              ✏️
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => openExecuteOverlay(t)}
            disabled={busyId === t.id}
            className="text-purple-600 dark:text-purple-300 hover:underline font-medium disabled:opacity-50"
            title="Mikey drafts a message for this task from the deal history in your voice — preview, edit, and send as you"
          >
            💬 Propose message
          </button>
        )}
        <button
          type="button"
          onClick={() => patchTask(t, "done")}
          disabled={busyId === t.id}
          className="text-gray-400 hover:text-green-600 disabled:opacity-50"
          title="Mark done (without sending)"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={() => patchTask(t, "dismissed")}
          disabled={busyId === t.id}
          className="text-gray-400 hover:text-red-500 disabled:opacity-50"
          title="Dismiss task"
        >
          ✕
        </button>
      </span>
    </div>
  );

  const Section = ({ title, tasks, tone }: { title: string; tasks: InboxTask[]; tone?: "danger" | "warn" }) =>
    tasks.length === 0 ? null : (
      <section className="mb-6">
        <h2
          className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            tone === "danger"
              ? "text-red-600 dark:text-red-400"
              : tone === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {title} ({tasks.length})
        </h2>
        <div className="space-y-2">{tasks.map((t) => <TaskRow key={t.id} t={t} />)}</div>
      </section>
    );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SalesNavBar />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">⚡ Deal Tasks</h1>
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 font-medium"
            title="Overdue commitments + deals gone quiet, with a proposed next move for each"
          >
            🩺 Execution review
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Every scheduled follow-up across your deals — execute, complete, or dismiss from here.{" "}
          <Link href="/deals" className="text-purple-600 dark:text-purple-300 hover:underline">← Back to deals</Link>
        </p>

        {/* Filter + sort bar */}
        <div className="mb-5 flex items-center gap-2 flex-wrap text-xs">
          <span className="relative inline-flex items-center">
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setFilterName(""); }}
              placeholder="Filter by deal…"
              className="pl-2.5 pr-7 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 w-36"
            />
            {filterName && (
              <button
                type="button"
                onClick={() => setFilterName("")}
                className="absolute right-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none"
                title="Clear deal filter (Esc)"
              >
                ✕
              </button>
            )}
          </span>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            title="Filter by deal stage"
          >
            <option value="all">All stages</option>
            {DEAL_STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            title="Filter by task type"
          >
            <option value="all">All types</option>
            <option value="executable">💬 Slack-executable</option>
            <option value="non_executable">Non-executable</option>
          </select>
          <select
            value={filterDue}
            onChange={(e) => setFilterDue(e.target.value as typeof filterDue)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            title="Filter by due state"
          >
            <option value="all">Any due date</option>
            <option value="past">Past due</option>
            <option value="scheduled">Scheduled (future date)</option>
            <option value="undated">Undated</option>
          </select>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            Sort:
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as typeof sortBy); setSortDir("asc"); }}
              className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
            >
              <option value="due">Due date</option>
              <option value="stage">Deal stage</option>
              <option value="activity">Last activity</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:border-purple-300"
            title={
              sortBy === "due"
                ? sortDir === "asc" ? "Soonest first — click for latest first" : "Latest first — click for soonest first"
                : sortBy === "stage"
                ? sortDir === "asc" ? "Early pipeline first — click for late pipeline first" : "Late pipeline first — click for early pipeline first"
                : sortDir === "asc" ? "Stalest deals first — click for most recently active first" : "Most recently active first — click for stalest first"
            }
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
          {filtersActive && (
            <button
              type="button"
              onClick={() => { setFilterName(""); setFilterStage("all"); setFilterType("all"); setFilterDue("all"); }}
              className="text-purple-600 dark:text-purple-300 hover:underline"
            >
              Clear ({sorted.length} of {open.length})
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="text-sm text-gray-400 py-10 text-center">Loading tasks…</div>
        ) : open.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
            No open tasks. Schedule follow-ups from any deal page, or let 🔎 detection propose them from your calls.
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
            No tasks match these filters.
          </div>
        ) : sortBy === "due" ? (
          <>
            <Section title="Overdue" tasks={overdue} tone="danger" />
            <Section title="Due today" tasks={dueToday} tone="warn" />
            <Section title="Upcoming" tasks={upcoming} />
          </>
        ) : (
          <Section
            title={
              sortBy === "stage"
                ? `By deal stage — ${sortDir === "asc" ? "early pipeline first" : "late pipeline first"}`
                : `By last deal activity — ${sortDir === "asc" ? "stalest first" : "most recent first"}`
            }
            tasks={sorted}
          />
        )}

        {loaded && resolved.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
              Recently handled
            </h2>
            <div className="space-y-1.5">
              {resolved.map((t) => (
                <div key={t.id} className="flex items-baseline gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <span>{t.status === "done" ? "✅" : "🚫"}</span>
                  <Link href={`/deals/${t.dealId}`} className="text-purple-500/70 hover:underline shrink-0">
                    {t.deal.companyName || t.deal.name}
                  </Link>
                  <span className={t.status === "done" ? "" : "line-through"}>{t.title}</span>
                  {t.resolvedAt && (
                    <span>
                      · {new Date(t.resolvedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {reviewOpen && (
        <DealExecutionReview onClose={() => setReviewOpen(false)} onChanged={load} />
      )}

      {/* Execute preview overlay — same contract as the deal page's. */}
      {executeTask && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => { if (!executeSending) { setExecuteTask(null); setExecuteError(null); } }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                🚀 Execute: {executeTask.title}
              </h3>
              <button
                onClick={() => { setExecuteTask(null); setExecuteError(null); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {executeTask.deal.slackChannelId ? (
                <>Sends to <span className="font-medium text-purple-700 dark:text-purple-300">#{executeTask.deal.slackChannelName || "channel"}</span> as <span className="font-medium">you</span> on the {executeTask.deal.companyName || executeTask.deal.name} deal. Edit before sending.</>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠️ No Slack channel linked — <Link href={`/deals/${executeTask.dealId}`} className="underline">open the deal</Link> to attach one first.
                </span>
              )}
            </p>
            {executeLoadingDraft ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8 justify-center">
                <svg className="animate-spin w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Drafting from deal evidence…
              </div>
            ) : (
              <textarea
                value={executeDraft}
                onChange={(e) => setExecuteDraft(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 resize-y"
                placeholder="The message to send…"
              />
            )}
            {executeError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{executeError}</p>}
            <label className="flex items-center gap-2 mt-2.5 text-xs text-gray-600 dark:text-gray-300">
              <span title="When Mikey should ping you to execute (or when you plan to send)">⏰ Execute at:</span>
              <input
                type="datetime-local"
                value={executeDue}
                onChange={(e) => setExecuteDue(e.target.value)}
                className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
              />
              {executeDue && (
                <button
                  type="button"
                  onClick={() => setExecuteDue("")}
                  className="text-gray-400 hover:text-gray-600"
                  title="Clear the due time (task won't ping)"
                >
                  ✕
                </button>
              )}
            </label>
            <div className="flex items-center justify-between gap-2 mt-3">
              <button
                type="button"
                onClick={regenerateExecuteDraft}
                disabled={executeLoadingDraft || executeSending || executeSaving}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 disabled:opacity-50"
              >
                ↻ Redraft
              </button>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setExecuteTask(null); setExecuteError(null); }}
                disabled={executeSending || executeSaving}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveExecuteEdits}
                disabled={executeSending || executeSaving || executeLoadingDraft}
                title="Save the message and due time without sending — the task pings at the new time with this message loaded"
                className="px-3 py-1.5 text-sm font-medium text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/40 disabled:opacity-50"
              >
                {executeSaving ? "Saving…" : "💾 Save for later"}
              </button>
              <button
                type="button"
                onClick={sendExecuteDraft}
                disabled={executeSending || executeLoadingDraft || !executeDraft.trim() || !executeTask.deal.slackChannelId}
                className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {executeSending ? "Sending…" : "🚀 Send as me"}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
