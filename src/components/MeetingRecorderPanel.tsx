"use client";

import { useState, useEffect, useCallback } from "react";

interface MeetingCall {
  id: string;
  title: string;
  date: string;
  duration?: number;
  participants: string[];
  attendees?: Array<{ name: string; email?: string }>;
  summary?: string;
  providerUrl?: string;
}

interface ProviderInfo {
  slug: string;
  name: string;
  icon: string;
  authType: string;
  connected: boolean;
}

export interface SelectedCallData {
  transcript: string;
  summary: string;
  recordingUrl?: string;
  title?: string;
  date?: string;
  attendees?: Array<{ name: string; email?: string; title?: string; company?: string }>;
}

interface MeetingRecorderPanelProps {
  onSelectCall?: (data: SelectedCallData) => void;
  onSelectCalls?: (calls: SelectedCallData[]) => void;
  defaultCollapsed?: boolean;
}

const DEEP_SEARCH_LIMIT = 500;

// Build a lowercased string that concatenates several common renderings of
// an ISO date so a substring check against the user's query hits the formats
// people actually type: "3/30", "03/30/2026", "March 30", "Mar 30, 2026",
// "2026-03-30". Returns empty if the ISO doesn't parse.
function dateSearchBlob(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const mm = String(m).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const longMonth = d.toLocaleString("en-US", { month: "long" });
  const shortMonth = d.toLocaleString("en-US", { month: "short" });
  return [
    iso.slice(0, 10),
    `${m}/${day}`,
    `${m}/${day}/${year}`,
    `${mm}/${dd}`,
    `${mm}/${dd}/${year}`,
    `${longMonth} ${day}`,
    `${longMonth} ${day}, ${year}`,
    `${shortMonth} ${day}`,
    `${shortMonth} ${day}, ${year}`,
  ].join(" ").toLowerCase();
}

export default function MeetingRecorderPanel({ onSelectCall, onSelectCalls, defaultCollapsed = false }: MeetingRecorderPanelProps) {
  const multiSelectMode = !!onSelectCalls;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [calls, setCalls] = useState<Array<{ provider: string; providerName: string; calls: MeetingCall[] }>>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingCallId, setFetchingCallId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null); // provider slug
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [callLimit, setCallLimit] = useState(15);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [existingMatches, setExistingMatches] = useState<Record<string, {
    recap?: { id: string; title: string; createdAt: string };
    review?: { id: string; title: string; overallScore: number | null; maxScore: number | null; createdAt: string };
  }>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCallIds, setSelectedCallIds] = useState<Set<string>>(new Set());
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [deepSearching, setDeepSearching] = useState(false);
  const [deepSearchDone, setDeepSearchDone] = useState(false);

  // Fetch existing recaps/reviews for the current call list
  const fetchExistingMatches = useCallback(async (callGroups: Array<{ calls: MeetingCall[] }>) => {
    const urls = callGroups.flatMap((g) => g.calls.map((c) => c.providerUrl).filter(Boolean)) as string[];
    if (urls.length === 0) return;
    try {
      const res = await fetch("/api/meeting-recorder/existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerUrls: urls }),
      });
      if (res.ok) {
        const data = await res.json();
        setExistingMatches(data.matches || {});
      }
    } catch { /* ignore */ }
  }, []);

  const loadData = useCallback(async (limit = 15) => {
    setLoading(true);
    try {
      const connRes = await fetch("/api/meeting-recorder/connections");
      if (connRes.ok) {
        const connData = await connRes.json();
        setProviders(connData.available || []);

        const hasActive = connData.available?.some((p: ProviderInfo) => p.connected);
        setConnected(hasActive);

        if (hasActive) {
          const callsRes = await fetch(`/api/meeting-recorder/calls?limit=${limit}`);
          if (callsRes.ok) {
            const callsData = await callsRes.json();
            const callGroups = callsData.calls || [];
            setCalls(callGroups);
            fetchExistingMatches(callGroups);
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [fetchExistingMatches]);

  const handleLoadMore = useCallback(async () => {
    const prevTotal = calls.reduce((sum, g) => sum + g.calls.length, 0);
    const newLimit = callLimit + 15;
    setLoadingMore(true);
    try {
      const callsRes = await fetch(`/api/meeting-recorder/calls?limit=${newLimit}`);
      if (callsRes.ok) {
        const callsData = await callsRes.json();
        const callGroups = callsData.calls || [];
        const newTotal = callGroups.reduce((sum: number, g: { calls: unknown[] }) => sum + g.calls.length, 0);
        if (prevTotal > 0 && newTotal < prevTotal) {
          console.warn(`[MeetingRecorder] Refusing to replace ${prevTotal} calls with ${newTotal}`);
        } else {
          setCalls(callGroups);
          setCallLimit(newLimit);
          fetchExistingMatches(callGroups);
          if (newTotal <= prevTotal) setHasMore(false);
        }
      }
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [callLimit, calls, fetchExistingMatches]);

  // Deep Search: fetch up to DEEP_SEARCH_LIMIT calls in one shot for full-history search
  const handleDeepSearch = useCallback(async () => {
    const prevTotal = calls.reduce((sum, g) => sum + g.calls.length, 0);
    setDeepSearching(true);
    try {
      const callsRes = await fetch(`/api/meeting-recorder/calls?limit=${DEEP_SEARCH_LIMIT}`);
      if (callsRes.ok) {
        const callsData = await callsRes.json();
        const callGroups = callsData.calls || [];
        const newTotal = callGroups.reduce((sum: number, g: { calls: unknown[] }) => sum + g.calls.length, 0);
        if (newTotal >= prevTotal) {
          setCalls(callGroups);
          setCallLimit(DEEP_SEARCH_LIMIT);
          fetchExistingMatches(callGroups);
          setHasMore(false);
          setDeepSearchDone(true);
        }
      }
    } catch { /* ignore */ }
    setDeepSearching(false);
  }, [calls, fetchExistingMatches]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleConnect = async () => {
    if (!showConnectModal || !apiKeyInput.trim()) return;
    setConnecting(true);
    setConnectError(null);

    try {
      const res = await fetch("/api/meeting-recorder/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: showConnectModal, apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setConnectError(data.error || "Failed to connect");
        return;
      }

      setShowConnectModal(null);
      setApiKeyInput("");
      await loadData(); // Refresh
    } catch {
      setConnectError("Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    await fetch(`/api/meeting-recorder/connections/${connectionId}`, { method: "DELETE" });
    await loadData();
  };

  const fetchCallDetail = useCallback(async (callId: string, provider: string): Promise<SelectedCallData | null> => {
    try {
      const res = await fetch(`/api/meeting-recorder/calls/${callId}?provider=${provider}`);
      if (!res.ok) return null;
      const data = await res.json();

      // Fall back to the summary from the list endpoint if the detail endpoint didn't return one
      let summary = data.call.summary || "";
      if (!summary) {
        for (const group of calls) {
          const listCall = group.calls.find((c) => c.id === callId);
          if (listCall?.summary) {
            summary = listCall.summary;
            break;
          }
        }
      }

      // Filter out internal attendees (same domain as the logged-in user's account)
      let attendees = data.call.attendees || [];
      try {
        const meRes = await fetch("/api/auth/me");
        if (meRes.ok) {
          const meData = await meRes.json();
          const userEmail = meData.user?.email || meData.user?.slackEmail;
          const accountDomain = meData.user?.accountDomain;
          const internalDomain = accountDomain || (userEmail ? userEmail.split("@")[1]?.toLowerCase() : null);
          const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "live.com", "me.com"];
          if (internalDomain && !FREE_DOMAINS.includes(internalDomain)) {
            attendees = attendees.filter((a: { email?: string }) => {
              if (!a.email) return true;
              return a.email.split("@")[1]?.toLowerCase() !== internalDomain;
            });
          }
        }
      } catch { /* proceed without filtering */ }

      // Enrich attendees via PDL if any have email addresses
      const hasEmails = attendees.some((a: { email?: string }) => a.email);
      if (hasEmails) {
        try {
          const enrichRes = await fetch("/api/meeting-recorder/enrich-attendees", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attendees }),
          });
          if (enrichRes.ok) {
            const enrichData = await enrichRes.json();
            attendees = enrichData.attendees || attendees;
          }
        } catch { /* use unenriched attendees */ }
      }

      return {
        transcript: data.call.transcript,
        summary,
        recordingUrl: data.call.providerUrl,
        title: data.call.title,
        date: data.call.date,
        attendees,
      };
    } catch {
      return null;
    }
  }, [calls]);

  const handleUseCall = async (callId: string, provider: string) => {
    if (!onSelectCall) return;
    setFetchingCallId(callId);
    const detail = await fetchCallDetail(callId, provider);
    if (detail) onSelectCall(detail);
    setFetchingCallId(null);
  };

  const handleBulkImport = async () => {
    if (!onSelectCalls || selectedCallIds.size === 0) return;
    // Resolve each selected id to its provider
    const targets: Array<{ id: string; provider: string }> = [];
    for (const group of calls) {
      for (const call of group.calls) {
        if (selectedCallIds.has(call.id)) {
          targets.push({ id: call.id, provider: group.provider });
        }
      }
    }
    setBulkImporting(true);
    setBulkProgress({ done: 0, total: targets.length });
    const results: SelectedCallData[] = [];
    for (let i = 0; i < targets.length; i++) {
      const detail = await fetchCallDetail(targets[i].id, targets[i].provider);
      if (detail) results.push(detail);
      setBulkProgress({ done: i + 1, total: targets.length });
    }
    onSelectCalls(results);
    setBulkImporting(false);
    setBulkProgress(null);
    setSelectedCallIds(new Set());
  };

  const toggleSelection = (callId: string) => {
    setSelectedCallIds((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatDuration = (seconds: number) => {
    const m = Math.round(seconds / 60);
    return `${m}m`;
  };

  if (loading) {
    return (
      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Meeting Recorder
            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {connected && !collapsed && (
            <button
              onClick={() => {
                const activeConn = providers.find((p) => p.connected);
                if (activeConn) {
                  // Find the connection ID to disconnect
                  fetch("/api/meeting-recorder/connections").then(r => r.json()).then(d => {
                    const conn = d.connections?.find((c: { provider: string }) => c.provider === activeConn.slug);
                    if (conn) handleDisconnect(conn.id);
                  });
                }
              }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>

        {collapsed ? null : !connected ? (
          /* Not connected state */
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Connect your meeting recorder to automatically import transcripts and summaries.
            </p>
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => {
                    if (p.authType === "oauth2") {
                      // Redirect to OAuth flow
                      window.location.href = `/api/meeting-recorder/oauth?provider=${p.slug}&returnTo=${encodeURIComponent(window.location.pathname)}`;
                    } else {
                      setShowConnectModal(p.slug);
                      setApiKeyInput("");
                      setConnectError(null);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors text-sm font-medium text-gray-700 dark:text-gray-200"
                >
                  <span>{p.icon}</span>
                  Connect {p.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Or paste a share link below.</p>
          </div>
        ) : (
          /* Connected state — show recent calls */
          <div>
            {/* Search input */}
            {calls.some((g) => g.calls.length > 0) && (
              <div className="mb-3 relative">
                <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && hasMore && !deepSearchDone && !deepSearching) handleDeepSearch(); }}
                  placeholder="Search by title, attendee, or email domain…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {calls.map((group) => {
              const q = searchQuery.trim().toLowerCase();
              const filtered = q
                ? group.calls.filter((call) => {
                    if (call.title?.toLowerCase().includes(q)) return true;
                    if (call.participants.some((p) => p.toLowerCase().includes(q))) return true;
                    if (call.attendees?.some((a) =>
                      a.name?.toLowerCase().includes(q) ||
                      a.email?.toLowerCase().includes(q)
                    )) return true;
                    if (call.summary?.toLowerCase().includes(q)) return true;
                    if (dateSearchBlob(call.date).includes(q)) return true;
                    return false;
                  })
                : group.calls;

              const totalInGroup = group.calls.length;
              const visibleInGroup = filtered.length;

              return (
              <div key={group.provider}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs text-green-600 font-medium">✓ {group.providerName}</span>
                  <span className="text-xs text-gray-400">
                    {q
                      ? `· ${visibleInGroup} of ${totalInGroup} match${deepSearchDone ? " (full history)" : ""}`
                      : `· ${totalInGroup} recent call${totalInGroup === 1 ? "" : "s"}${deepSearchDone ? " (full history)" : ""}`}
                  </span>
                </div>
                {deepSearching && (
                  <div className="flex items-center gap-2 py-2.5 px-3 mb-2 bg-purple-50 border border-purple-200 rounded-lg">
                    <svg className="animate-spin h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm font-medium text-purple-700">Searching your full call history...</span>
                  </div>
                )}
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {filtered.map((call) => {
                    const match = call.providerUrl ? existingMatches[call.providerUrl] : undefined;
                    const isChecked = selectedCallIds.has(call.id);
                    // Native tooltip listing who was on the call. Helps
                    // disambiguate same-titled recurring meetings at a
                    // glance.
                    const participantsTooltip =
                      call.participants.length > 0
                        ? `${call.title}\n\nAttendees:\n${call.participants.map((p) => `• ${p}`).join("\n")}`
                        : call.title;
                    return (
                    <div key={call.id}>
                      <button
                        title={participantsTooltip}
                        onClick={() => {
                          if (multiSelectMode) {
                            toggleSelection(call.id);
                          } else {
                            setSelectedCallId(call.id);
                            handleUseCall(call.id, group.provider);
                          }
                        }}
                        disabled={!multiSelectMode && fetchingCallId !== null}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-all text-left cursor-pointer disabled:cursor-wait ${
                          (multiSelectMode ? isChecked : selectedCallId === call.id)
                            ? "border-purple-400 bg-purple-50 ring-1 ring-purple-200"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-purple-300 hover:bg-purple-50/50 hover:shadow-sm"
                        }`}
                      >
                        {multiSelectMode && (
                          <div className="flex-shrink-0 mr-2.5">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isChecked ? "bg-purple-600 border-purple-600" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"}`}>
                              {isChecked && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs text-gray-400">{formatDate(call.date)}</span>
                            {call.duration != null && call.duration > 0 && <span className="text-xs text-gray-400">· {formatDuration(call.duration)}</span>}
                            {call.participants.length > 0 && (
                              <span className="text-xs text-gray-400">· {call.participants.length} people</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 truncate font-medium">{call.title}</p>
                          {match && (
                            <div className="flex items-center gap-2 mt-1">
                              {match.recap && (
                                <a
                                  href={`/call-recap?id=${match.recap.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  <span>✉</span> Recap
                                </a>
                              )}
                              {match.review && (
                                <a
                                  href={`/call-review?version=${match.review.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 hover:underline"
                                >
                                  <span>✓</span> Review {match.review.overallScore !== null && match.review.maxScore !== null ? `${match.review.overallScore}/${match.review.maxScore}` : ""}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                        {!multiSelectMode && (
                          fetchingCallId === call.id ? (
                            <span className="ml-3 flex items-center gap-1 text-xs text-purple-600 flex-shrink-0">
                              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Loading...
                            </span>
                          ) : selectedCallId === call.id ? (
                            <span className="ml-3 text-xs text-purple-600 font-medium flex-shrink-0">
                              ✓ Selected
                            </span>
                          ) : (
                            <span className="ml-3 text-xs text-gray-400 group-hover:text-purple-500 flex-shrink-0">
                              Select →
                            </span>
                          )
                        )}
                      </button>
                    </div>
                    );
                  })}
                  {totalInGroup === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No recent calls found</p>
                  )}
                  {totalInGroup > 0 && visibleInGroup === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No calls match &quot;{searchQuery}&quot;</p>
                  )}
                </div>
                {/* Load more + Deep Search */}
                {totalInGroup > 0 && hasMore && !deepSearching && (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="flex-1 py-1.5 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {loadingMore ? (
                        <>
                          <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading...
                        </>
                      ) : (
                        "Load more calls..."
                      )}
                    </button>
                    {!deepSearchDone && (
                      <button
                        onClick={handleDeepSearch}
                        disabled={deepSearching}
                        className="flex-1 py-1.5 text-xs text-purple-700 font-medium hover:text-purple-900 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Deep Search (full history)
                      </button>
                    )}
                  </div>
                )}
                {/* Deep Search prompt when search query has no matches and more calls exist */}
                {q && visibleInGroup === 0 && hasMore && !deepSearchDone && !deepSearching && (
                  <button
                    onClick={handleDeepSearch}
                    className="w-full mt-1 py-2 text-xs text-purple-700 font-medium bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    No matches — search your full call history?
                  </button>
                )}
              </div>
              );
            })}

            {/* Multi-select action bar */}
            {multiSelectMode && selectedCallIds.size > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 p-2.5 bg-purple-50 border border-purple-200 rounded-lg">
                <span className="text-sm font-medium text-purple-900">
                  {selectedCallIds.size} call{selectedCallIds.size === 1 ? "" : "s"} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedCallIds(new Set())}
                    disabled={bulkImporting}
                    className="text-xs text-purple-700 hover:text-purple-900 px-2 py-1 rounded disabled:opacity-50"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleBulkImport}
                    disabled={bulkImporting}
                    className="text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {bulkImporting ? (
                      <>
                        <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Importing {bulkProgress?.done ?? 0}/{bulkProgress?.total ?? 0}…
                      </>
                    ) : (
                      `Import ${selectedCallIds.size} call${selectedCallIds.size === 1 ? "" : "s"}`
                    )}
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 mt-2">Or paste a share link below.</p>
          </div>
        )}
      </div>

      {/* Connect modal */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Connect {providers.find((p) => p.slug === showConnectModal)?.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Paste your API key to connect.{" "}
              {showConnectModal === "granola" && (
                <a
                  href="https://docs.granola.ai/introduction#obtaining-an-api-key"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 underline underline-offset-2"
                >
                  How to get your Granola API key
                </a>
              )}
              {showConnectModal === "fireflies" && (
                <a
                  href="https://docs.fireflies.ai/fundamentals/authorization#how-to-find-your-api-key"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 underline underline-offset-2"
                >
                  How to get your Fireflies API key
                </a>
              )}
            </p>

            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
              placeholder="Paste your API key..."
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent mb-3 font-mono"
              autoFocus
            />

            {connectError && (
              <p className="text-sm text-red-600 mb-3">{connectError}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowConnectModal(null); setApiKeyInput(""); setConnectError(null); }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting || !apiKeyInput.trim()}
                className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
