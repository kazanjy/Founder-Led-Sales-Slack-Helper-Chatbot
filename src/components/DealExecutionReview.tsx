"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getStageInfo } from "@/lib/deals/constants";

/**
 * Deal Execution Review overlay — used from /deals and /deals/tasks.
 * Opens instantly on deterministic data (overdue tasks + quiet deals);
 * per-deal LLM proposals fire only on explicit "✨ Propose action":
 *   send_message → editable draft + 🚀 Send as me (creates the task,
 *                  executes it, proof lands on the timeline)
 *                  or 🕒 Schedule task (armed, pings when due)
 *   close_lost   → one-click Mark closed lost (confirmed)
 *   wait         → rationale only
 */

interface OverdueTaskRow {
  id: string;
  dealId: string;
  title: string;
  dueAt: string | null;
  status: string;
  executeVia: string | null;
  hasDraft: boolean;
  dealName: string;
  companyName: string | null;
}

interface QuietDeal {
  id: string;
  name: string;
  companyName: string | null;
  stage: string;
  status: string;
  daysQuiet: number;
  lastActivityAt: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  slackChannelId: string | null;
  slackChannelName: string | null;
}

interface Proposal {
  action: "send_message" | "close_lost" | "wait";
  rationale: string;
  taskTitle: string;
  message: string | null;
}

const ACTION_BADGES: Record<Proposal["action"], { label: string; className: string }> = {
  send_message: { label: "💬 Send a message", className: "bg-purple-100 text-purple-800" },
  close_lost: { label: "🪦 Consider closing lost", className: "bg-red-100 text-red-700" },
  wait: { label: "⏳ Waiting is right", className: "bg-gray-100 text-gray-600" },
};

function Spin({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export function DealExecutionReview({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [overdue, setOverdue] = useState<OverdueTaskRow[]>([]);
  const [quiet, setQuiet] = useState<QuietDeal[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Per-deal proposal state
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, string>>({});

  // Default schedule slot: tomorrow 9am local, as a datetime-local value.
  const defaultScheduleSlot = () => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/deals/execution-review");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || "Failed to load review");
      setOverdue(Array.isArray(data.overdueTasks) ? data.overdueTasks : []);
      setQuiet(Array.isArray(data.quietDeals) ? data.quietDeals : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const propose = async (dealId: string) => {
    if (proposingId) return;
    setProposingId(dealId);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/propose-action`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || data?.error || "Proposal failed");
      setProposals((prev) => ({ ...prev, [dealId]: data }));
      if (data.message) setDrafts((prev) => ({ ...prev, [dealId]: data.message }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proposal failed");
    } finally {
      setProposingId(null);
    }
  };

  const setFlashFor = (dealId: string, msg: string) => {
    setFlash((prev) => ({ ...prev, [dealId]: msg }));
  };

  /** Create the follow-up task carrying the (possibly edited) draft.
   *  Returns the task id, or null on failure. */
  const createTask = async (d: QuietDeal, p: Proposal, dueAtIso: string): Promise<string | null> => {
    const res = await fetch(`/api/deals/${d.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: p.taskTitle,
        rationale: `Execution review: ${p.rationale.slice(0, 250)}`,
        dueAt: dueAtIso,
        executeVia: "slack_channel",
        draftMessage: (drafts[d.id] || p.message || "").trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.task?.id) {
      setError(data?.error || "Failed to create the task");
      return null;
    }
    return data.task.id as string;
  };

  const sendNow = async (d: QuietDeal, p: Proposal) => {
    const message = (drafts[d.id] || "").trim();
    if (!message || actingId) return;
    setActingId(d.id);
    setError(null);
    try {
      const taskId = await createTask(d, p, new Date().toISOString());
      if (!taskId) return;
      const res = await fetch(`/api/deals/${d.id}/tasks/${taskId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const reasonText: Record<string, string> = {
          no_channel: "No Slack channel linked — the task was scheduled instead; attach a channel to send.",
          send_failed: "Slack rejected the send — the task is scheduled; try from the deal page.",
        };
        throw new Error(reasonText[data?.reason] || data?.error || "Send failed");
      }
      setFlashFor(d.id, `✓ Sent to #${d.slackChannelName || "channel"} as you — proof logged on the timeline.`);
      onChanged?.();
    } catch (err) {
      setFlashFor(d.id, err instanceof Error ? `⚠️ ${err.message}` : "⚠️ Send failed");
    } finally {
      setActingId(null);
    }
  };

  const scheduleTask = async (d: QuietDeal, p: Proposal) => {
    if (actingId) return;
    const slot = scheduleAt[d.id] || defaultScheduleSlot();
    const due = new Date(slot);
    if (isNaN(due.getTime())) return;
    setActingId(d.id);
    setError(null);
    try {
      const taskId = await createTask(d, p, due.toISOString());
      if (taskId) {
        setFlashFor(
          d.id,
          `✓ Task scheduled for ${due.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} with the message loaded — Mikey pings you then.`
        );
        onChanged?.();
      }
    } finally {
      setActingId(null);
    }
  };

  const markClosedLost = async (d: QuietDeal) => {
    if (actingId) return;
    if (!window.confirm(`Mark ${d.companyName || d.name} as Closed Lost?`)) return;
    setActingId(d.id);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed_lost" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update the deal");
      }
      setFlashFor(d.id, "✓ Closed lost. It stays on the books (and its Slack channel keeps syncing for re-engagement signals).");
      onChanged?.();
    } catch (err) {
      setFlashFor(d.id, err instanceof Error ? `⚠️ ${err.message}` : "⚠️ Update failed");
    } finally {
      setActingId(null);
    }
  };

  const fmtDue = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "no date";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-base font-semibold text-gray-900">🩺 Deal Execution Review</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Overdue commitments and deals gone quiet — with a proposed next move for each. Proposals
          run on demand (each one reads the full deal history).
        </p>

        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start justify-between gap-2">
            <span className="min-w-0 break-words">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {loading ? (
          <div className="py-10 flex justify-center text-purple-600"><Spin className="h-6 w-6" /></div>
        ) : (
          <>
            {/* Overdue tasks */}
            <div className="mb-5">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">
                  ⏰ Overdue tasks ({overdue.length})
                </h4>
                {overdue.length > 0 && (
                  <Link href="/deals/tasks?due=past" className="text-xs text-purple-600 hover:underline">
                    Review all in the inbox →
                  </Link>
                )}
              </div>
              {overdue.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing overdue. 🎉</p>
              ) : (
                <div className="space-y-1">
                  {overdue.slice(0, 8).map((t) => (
                    <div key={t.id} className="flex items-baseline gap-2 text-sm">
                      <span className="text-xs text-red-500 shrink-0 w-14">{fmtDue(t.dueAt)}</span>
                      <Link href={`/deals/${t.dealId}`} className="text-xs font-semibold text-purple-700 hover:underline shrink-0">
                        {t.companyName || t.dealName}
                      </Link>
                      <span className="text-gray-800 truncate">{t.title}</span>
                      {t.executeVia === "slack_channel" && t.hasDraft && (
                        <span className="text-[10px] text-green-600 shrink-0" title="Message loaded — one touch to send">💬 armed</span>
                      )}
                    </div>
                  ))}
                  {overdue.length > 8 && (
                    <p className="text-xs text-gray-400">…and {overdue.length - 8} more in the inbox.</p>
                  )}
                </div>
              )}
            </div>

            {/* Quiet deals */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-2">
                😴 Quiet deals ({quiet.length})
              </h4>
              {quiet.length === 0 ? (
                <p className="text-xs text-gray-400">Every in-play deal has activity in the last 7 days.</p>
              ) : (
                <div className="space-y-2.5">
                  {quiet.map((d) => {
                    const p = proposals[d.id];
                    const stage = getStageInfo(d.stage);
                    return (
                      <div key={d.id} className="p-3 rounded-lg border border-gray-200 bg-gray-50/60">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/deals/${d.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                            {d.companyName || d.name}
                          </Link>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stage.color}`}>{stage.label}</span>
                          <span className="text-xs text-amber-700 font-medium">{d.daysQuiet}d quiet</span>
                          {d.overdueTaskCount > 0 ? (
                            <span className="text-xs text-red-600">{d.overdueTaskCount} overdue task{d.overdueTaskCount === 1 ? "" : "s"}</span>
                          ) : d.openTaskCount > 0 ? (
                            <span className="text-xs text-gray-500">{d.openTaskCount} open task{d.openTaskCount === 1 ? "" : "s"}</span>
                          ) : null}
                          <span className="flex-1" />
                          {!p && (
                            <button
                              onClick={() => propose(d.id)}
                              disabled={proposingId !== null}
                              className="text-xs px-2.5 py-1 rounded-md border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50 inline-flex items-center gap-1.5"
                              title="Mikey reads the full deal history and recommends: send a message (drafted in your voice), close it lost, or keep waiting"
                            >
                              {proposingId === d.id ? (
                                <><Spin className="h-3 w-3" /> Reading the deal…</>
                              ) : (
                                <>✨ Propose action</>
                              )}
                            </button>
                          )}
                        </div>

                        {p && (
                          <div className="mt-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${ACTION_BADGES[p.action].className}`}>
                                {ACTION_BADGES[p.action].label}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1.5">{p.rationale}</p>

                            {p.action === "send_message" && (
                              <>
                                <textarea
                                  value={drafts[d.id] ?? p.message ?? ""}
                                  onChange={(e) => setDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                  rows={3}
                                  className="mt-2 w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md bg-white"
                                />
                                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                  {d.slackChannelId ? (
                                    <button
                                      onClick={() => sendNow(d, p)}
                                      disabled={actingId !== null || !(drafts[d.id] || "").trim()}
                                      className="text-xs px-2.5 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                                    >
                                      {actingId === d.id ? <Spin className="h-3 w-3" /> : "🚀"}
                                      Send to #{d.slackChannelName || "channel"} as me
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-amber-600">
                                      ⚠️ No Slack channel linked —{" "}
                                      <Link href={`/deals/${d.id}`} className="underline">attach one</Link> to send directly.
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1.5">
                                    <input
                                      type="datetime-local"
                                      value={scheduleAt[d.id] ?? defaultScheduleSlot()}
                                      onChange={(e) =>
                                        setScheduleAt((prev) => ({ ...prev, [d.id]: e.target.value }))
                                      }
                                      className="text-[11px] px-1.5 py-1 rounded-md border border-gray-300 bg-white text-gray-700"
                                      title="When to execute — Mikey pings you then with the one-touch send"
                                    />
                                    <button
                                      onClick={() => scheduleTask(d, p)}
                                      disabled={actingId !== null}
                                      className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                      title="Save as a task due at the chosen time with this message loaded — Mikey pings you with the one-touch send"
                                    >
                                      🕒 Schedule
                                    </button>
                                  </span>
                                </div>
                              </>
                            )}

                            {p.action === "close_lost" && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => markClosedLost(d)}
                                  disabled={actingId !== null}
                                  className="text-xs px-2.5 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                                >
                                  {actingId === d.id ? <Spin className="h-3 w-3" /> : "🪦"}
                                  Mark closed lost
                                </button>
                                <button
                                  onClick={() => scheduleTask(d, p)}
                                  disabled={actingId !== null}
                                  className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                  title="Disagree? Schedule a follow-up task instead"
                                >
                                  🕒 Nudge instead
                                </button>
                              </div>
                            )}

                            {flash[d.id] && (
                              <p className={`text-xs mt-2 ${flash[d.id].startsWith("✓") ? "text-green-700" : "text-red-600"}`}>
                                {flash[d.id]}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
