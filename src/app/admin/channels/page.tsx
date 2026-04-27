"use client";

import { useEffect, useState, useMemo } from "react";
import { useCmdEnterToSubmit } from "@/components/useCmdEnterToSubmit";

interface Workspace {
  id: string;
  slackTeamId: string;
  slackTeamName: string;
}

interface Channel {
  id: string;
  slackChannelId: string;
  slackChannelName: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  account: { id: string; name: string };
  claimedBy: { id: string; name: string | null; email: string | null };
}

interface Delivery {
  channelClaimId: string;
  channelName: string | null;
  status: "sent" | "failed";
  ts?: string;
  error?: string;
}

interface ScheduledCampaign {
  id: string;
  name: string | null;
  body: string;
  scheduledFor: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdByAdmin: { id: string; name: string | null; email: string | null };
  _count: { deliveries: number };
}

const LAST_WORKSPACE_KEY = "admin_channels:selectedWorkspaceId";

// A small curated set of timezones — covers the cases I expect to come
// up most often. Browser TZ is always prepended as the default below.
const TIMEZONE_OPTIONS = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/**
 * Convert a "wall clock" datetime-local string (YYYY-MM-DDTHH:mm,
 * which carries no timezone) plus an IANA timezone into the absolute
 * UTC instant. Uses Intl.DateTimeFormat to back-solve the timezone
 * offset rather than dragging in a date library.
 */
function wallClockInTzToUtc(localDateTime: string, tz: string): Date {
  const [datePart, timePart] = localDateTime.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const wantUtcMs = Date.UTC(y, mo - 1, d, h, mi);

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(wantUtcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const gotUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));

  // The difference between the wall-clock we wanted and the wall-clock
  // we got when we naively used the same numbers in UTC tells us how
  // far off we are. Adding it back gives us the true UTC instant.
  const offset = wantUtcMs - gotUtcMs;
  return new Date(wantUtcMs + offset);
}

function formatScheduledFor(iso: string | null, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
    if (hours < 1) return "just now";
    if (hours === 1) return "1h ago";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminChannelsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Delivery[] | null>(null);
  const [scheduledMode, setScheduledMode] = useState<"now" | "later">("now");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [scheduleTimezone, setScheduleTimezone] = useState(browserTz);
  const [scheduledConfirmation, setScheduledConfirmation] = useState<{ scheduledFor: string; tz: string } | null>(null);
  const [campaigns, setCampaigns] = useState<ScheduledCampaign[]>([]);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [adminConnection, setAdminConnection] = useState<{
    displayName: string | null;
    hasUserToken: boolean;
  } | null>(null);

  useEffect(() => {
    document.title = "Admin - Channels";
  }, []);

  // Load workspaces on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/workspaces?limit=500");
        if (!res.ok) return;
        const data = await res.json();
        const list: Workspace[] = data.workspaces || [];
        setWorkspaces(list);
        if (typeof window !== "undefined") {
          const saved = window.localStorage.getItem(LAST_WORKSPACE_KEY);
          if (saved && list.some((w) => w.id === saved)) {
            setWorkspaceId(saved);
          }
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingWorkspaces(false);
      }
    })();
  }, []);

  const loadCampaigns = async (wsId: string) => {
    try {
      const res = await fetch(`/api/admin/broadcast?workspaceId=${encodeURIComponent(wsId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setCampaigns(data.campaigns || []);
      if (data.adminConnection) setAdminConnection(data.adminConnection);
    } catch {
      /* ignore */
    }
  };

  // Reload channels (and the campaign list) when workspace changes.
  useEffect(() => {
    if (!workspaceId) {
      setChannels([]);
      setCampaigns([]);
      return;
    }
    setLoadingChannels(true);
    setSelected(new Set());
    loadCampaigns(workspaceId);
    (async () => {
      try {
        const res = await fetch(`/api/admin/channels?workspaceId=${encodeURIComponent(workspaceId)}`);
        if (!res.ok) return;
        const data = await res.json();
        setChannels(data.channels || []);
      } catch {
        /* ignore */
      } finally {
        setLoadingChannels(false);
      }
    })();
  }, [workspaceId]);

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) =>
      (c.slackChannelName || c.slackChannelId).toLowerCase().includes(q)
      || c.account.name.toLowerCase().includes(q)
      || (c.claimedBy.name || c.claimedBy.email || "").toLowerCase().includes(q)
    );
  }, [channels, search]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allVisibleIds = filteredChannels.map((c) => c.id);
    const allSelected = allVisibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of allVisibleIds) next.delete(id);
      } else {
        for (const id of allVisibleIds) next.add(id);
      }
      return next;
    });
  };

  const openCompose = () => {
    setMessage("");
    setResults(null);
    setScheduledConfirmation(null);
    setScheduledMode("now");
    setScheduleDateTime("");
    setScheduleTimezone(browserTz);
    setComposeOpen(true);
  };

  const closeCompose = () => {
    if (sending) return;
    setComposeOpen(false);
  };

  // For Schedule-for-later mode, we need a real future timestamp.
  const scheduledForUtc = scheduledMode === "later" && scheduleDateTime
    ? wallClockInTzToUtc(scheduleDateTime, scheduleTimezone)
    : null;
  const scheduledIsValidFuture = scheduledForUtc !== null && scheduledForUtc.getTime() > Date.now();
  const canSubmit = !!message.trim()
    && selected.size > 0
    && !sending
    && (scheduledMode === "now" || scheduledIsValidFuture)
    && !!adminConnection?.hasUserToken;

  const handleSend = async () => {
    if (!canSubmit) return;
    setSending(true);
    setResults(null);
    setScheduledConfirmation(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          channelClaimIds: Array.from(selected),
          body: message,
          scheduledFor: scheduledForUtc ? scheduledForUtc.toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Send failed");
        return;
      }
      if (data.deliveries) {
        // Send-now path: fall through to the existing per-channel results UI.
        setResults(data.deliveries);
      } else if (data.campaign?.scheduledFor) {
        // Send-later path: confirmation card; refresh the scheduled list.
        setScheduledConfirmation({ scheduledFor: data.campaign.scheduledFor, tz: scheduleTimezone });
      }
      if (workspaceId) loadCampaigns(workspaceId);
    } catch (err) {
      alert("Send failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSending(false);
    }
  };

  useCmdEnterToSubmit(handleSend, composeOpen && canSubmit);

  const cancelCampaign = async (campaignId: string) => {
    if (!confirm("Cancel this scheduled broadcast? This can't be undone.")) return;
    setCancelingId(campaignId);
    try {
      const res = await fetch(`/api/admin/broadcast/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Cancel failed");
        return;
      }
      if (workspaceId) loadCampaigns(workspaceId);
    } finally {
      setCancelingId(null);
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId);
  const sentCount = results?.filter((r) => r.status === "sent").length ?? 0;
  const failedCount = results?.filter((r) => r.status === "failed").length ?? 0;
  const visibleSelectedCount = filteredChannels.filter((c) => selected.has(c.id)).length;
  const allVisibleSelected = filteredChannels.length > 0
    && filteredChannels.every((c) => selected.has(c.id));

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500 mt-1">Pick a workspace, choose channels, and send a broadcast message.</p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-700">Workspace:</label>
        <select
          value={workspaceId}
          onChange={(e) => {
            const next = e.target.value;
            setWorkspaceId(next);
            if (typeof window !== "undefined") {
              if (next) window.localStorage.setItem(LAST_WORKSPACE_KEY, next);
              else window.localStorage.removeItem(LAST_WORKSPACE_KEY);
            }
          }}
          disabled={loadingWorkspaces}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent min-w-[260px]"
        >
          <option value="">{loadingWorkspaces ? "Loading..." : "— Select workspace —"}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.slackTeamName}</option>
          ))}
        </select>
        {workspaceId && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter channels..."
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent min-w-[220px]"
          />
        )}
      </div>

      {!workspaceId && !loadingWorkspaces && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
          Select a workspace to see its channels.
        </div>
      )}

      {workspaceId && campaigns.some((c) => c.status === "scheduled") && (
        <div className="mb-4 bg-purple-50 border border-purple-100 rounded-xl overflow-hidden">
          <div className="px-4 py-2 text-xs font-medium text-purple-900 uppercase tracking-wider">
            Scheduled
          </div>
          <div className="divide-y divide-purple-100">
            {campaigns
              .filter((c) => c.status === "scheduled")
              .map((c) => (
                <div key={c.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 truncate">{c.body}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {c._count.deliveries} channel{c._count.deliveries === 1 ? "" : "s"}
                      {" · "}
                      {formatScheduledFor(c.scheduledFor, browserTz)}
                      {c.createdByAdmin?.name || c.createdByAdmin?.email ? (
                        <>
                          {" · by "}
                          {c.createdByAdmin.name || c.createdByAdmin.email}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancelCampaign(c.id)}
                    disabled={cancelingId === c.id}
                    className="flex-shrink-0 text-xs px-2.5 py-1 rounded-md text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                  >
                    {cancelingId === c.id ? "Canceling…" : "Cancel"}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {workspaceId && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50 gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                disabled={filteredChannels.length === 0}
              />
              <span>
                {selected.size > 0
                  ? `${selected.size} selected${search ? ` (${visibleSelectedCount} shown)` : ""}`
                  : `${filteredChannels.length} channel${filteredChannels.length === 1 ? "" : "s"}${search && filteredChannels.length !== channels.length ? ` of ${channels.length}` : ""}`}
              </span>
            </label>
            <button
              type="button"
              onClick={openCompose}
              disabled={selected.size === 0}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              Compose message
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </div>

          {loadingChannels ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">Loading channels…</div>
          ) : filteredChannels.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              {channels.length === 0
                ? "No channels have been claimed in this workspace yet."
                : `No channels match "${search}".`}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium w-12"></th>
                  <th className="px-4 py-2 text-left font-medium">Channel</th>
                  <th className="px-4 py-2 text-left font-medium">Last activity</th>
                  <th className="px-4 py-2 text-left font-medium">Account</th>
                  <th className="px-4 py-2 text-left font-medium">Owner</th>
                </tr>
              </thead>
              <tbody>
                {filteredChannels.map((c) => {
                  const isSelected = selected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => toggleOne(c.id)}
                      className={`border-b border-gray-100 last:border-b-0 cursor-pointer transition-colors ${isSelected ? "bg-purple-50 hover:bg-purple-100" : "hover:bg-gray-50"}`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {c.slackChannelName ? `#${c.slackChannelName}` : c.slackChannelId}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{formatRelative(c.lastMessageAt)}</td>
                      <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{c.account.name}</td>
                      <td className="px-4 py-2 text-gray-500 truncate max-w-xs">
                        {c.claimedBy.name || c.claimedBy.email || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeCompose(); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-xl w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Broadcast message</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sending to <strong>{selected.size}</strong> channel{selected.size === 1 ? "" : "s"}
                  {activeWorkspace ? ` in ${activeWorkspace.slackTeamName}` : ""}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCompose}
                disabled={sending}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {scheduledConfirmation ? (
              <div>
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 text-sm text-purple-900">
                  <div className="font-medium">Scheduled.</div>
                  <div className="text-xs text-purple-800 mt-1">
                    Sending to {selected.size} channel{selected.size === 1 ? "" : "s"} on{" "}
                    {formatScheduledFor(scheduledConfirmation.scheduledFor, scheduledConfirmation.tz)}.
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <button
                    type="button"
                    onClick={closeCompose}
                    className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : results ? (
              <div>
                <div className="mb-3 text-sm text-gray-700">
                  <span className="text-green-600 font-medium">{sentCount} sent</span>
                  {failedCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-red-600 font-medium">{failedCount} failed</span>
                    </>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {results.map((r, i) => (
                    <div key={`${r.channelClaimId}-${i}`} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                      <span className="truncate flex-1 text-gray-700">
                        {r.channelName ? `#${r.channelName}` : r.channelClaimId}
                      </span>
                      <span className={r.status === "sent" ? "text-green-600 font-medium" : "text-red-600"}>
                        {r.status === "sent" ? "✓ sent" : `✗ ${r.error || "failed"}`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-3">
                  <button
                    type="button"
                    onClick={closeCompose}
                    className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {adminConnection && !adminConnection.hasUserToken ? (
                  <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3">
                    <div className="text-xs text-amber-900">
                      <div className="font-medium">Connect Slack to send as yourself.</div>
                      <div className="mt-0.5 text-amber-800">
                        Without it, messages would post as MikeyBot. We&rsquo;ll redirect you to Slack to grant the extra permission, then bring you back.
                      </div>
                    </div>
                    <a
                      href="/api/slack/oauth"
                      className="flex-shrink-0 text-xs font-medium px-3 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700"
                    >
                      Connect Slack
                    </a>
                  </div>
                ) : adminConnection?.hasUserToken ? (
                  <div className="mb-2 text-[11px] text-gray-500">
                    Will post as <span className="font-medium text-gray-700">@{adminConnection.displayName || "you"}</span>.
                  </div>
                ) : null}
                <textarea
                  autoFocus
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write the message. Slack *bold* / _italics_ / `code` supported."
                  rows={8}
                  disabled={sending}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono disabled:opacity-60"
                />
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setScheduledMode("now")}
                      disabled={sending}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${scheduledMode === "now" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduledMode("later")}
                      disabled={sending}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${scheduledMode === "later" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Schedule for later
                    </button>
                  </div>
                  {scheduledMode === "later" && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <input
                        type="datetime-local"
                        value={scheduleDateTime}
                        onChange={(e) => setScheduleDateTime(e.target.value)}
                        disabled={sending}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <select
                        value={scheduleTimezone}
                        onChange={(e) => setScheduleTimezone(e.target.value)}
                        disabled={sending}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        {/* Browser TZ first, then the curated list (skip if it's a dup). */}
                        <option value={browserTz}>{browserTz} (yours)</option>
                        {TIMEZONE_OPTIONS.filter((tz) => tz !== browserTz).map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                      {scheduleDateTime && scheduledForUtc && (
                        <span className="text-[11px] text-gray-500">
                          {scheduledIsValidFuture
                            ? `→ ${formatScheduledFor(scheduledForUtc.toISOString(), scheduleTimezone)}`
                            : "Pick a future time"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-3">
                  <span className="text-[11px] text-gray-400">{message.length} chars</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeCompose}
                      disabled={sending}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!canSubmit}
                      className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {sending ? (
                        <>
                          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          {scheduledMode === "later" ? "Scheduling…" : "Sending…"}
                        </>
                      ) : (
                        scheduledMode === "later" ? `Schedule for ${selected.size}` : `Send to ${selected.size}`
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
