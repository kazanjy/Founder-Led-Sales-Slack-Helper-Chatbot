"use client";

import { useState, useEffect, useCallback } from "react";

interface MeetingCall {
  id: string;
  title: string;
  date: string;
  duration?: number;
  participants: string[];
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

interface MeetingRecorderPanelProps {
  onSelectCall: (data: { transcript: string; summary: string; recordingUrl?: string; title?: string; date?: string; attendees?: Array<{ name: string; email?: string }> }) => void;
  defaultCollapsed?: boolean;
}

export default function MeetingRecorderPanel({ onSelectCall, defaultCollapsed = false }: MeetingRecorderPanelProps) {
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
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [existingMatches, setExistingMatches] = useState<Record<string, {
    recap?: { id: string; title: string; createdAt: string };
    review?: { id: string; title: string; overallScore: number | null; maxScore: number | null; createdAt: string };
  }>>({});

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
    const newLimit = callLimit + 15;
    setLoadingMore(true);
    try {
      const callsRes = await fetch(`/api/meeting-recorder/calls?limit=${newLimit}`);
      if (callsRes.ok) {
        const callsData = await callsRes.json();
        const callGroups = callsData.calls || [];
        setCalls(callGroups);
        setCallLimit(newLimit);
        fetchExistingMatches(callGroups);
      }
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [callLimit, fetchExistingMatches]);

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

  const handleUseCall = async (callId: string, provider: string) => {
    setFetchingCallId(callId);
    try {
      const res = await fetch(`/api/meeting-recorder/calls/${callId}?provider=${provider}`);
      if (res.ok) {
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

        onSelectCall({
          transcript: data.call.transcript,
          summary,
          recordingUrl: data.call.providerUrl,
          title: data.call.title,
          date: data.call.date,
          attendees: data.call.attendees,
        });
      }
    } catch {
      console.error("Failed to fetch call detail");
    } finally {
      setFetchingCallId(null);
    }
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
      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl">
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
      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-sm font-semibold text-gray-700 flex items-center gap-2 hover:text-gray-900 transition-colors"
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
            <p className="text-sm text-gray-500 mb-3">
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
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors text-sm font-medium text-gray-700"
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
            {calls.map((group) => (
              <div key={group.provider}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs text-green-600 font-medium">✓ {group.providerName}</span>
                  <span className="text-xs text-gray-400">· {group.calls.length} recent calls</span>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {group.calls.map((call) => {
                    const match = call.providerUrl ? existingMatches[call.providerUrl] : undefined;
                    return (
                    <div key={call.id}>
                      <button
                        onClick={() => {
                          setSelectedCallId(call.id);
                          handleUseCall(call.id, group.provider);
                        }}
                        disabled={fetchingCallId !== null}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-all text-left cursor-pointer disabled:cursor-wait ${
                          selectedCallId === call.id
                            ? "border-purple-400 bg-purple-50 ring-1 ring-purple-200"
                            : "border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/50 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs text-gray-400">{formatDate(call.date)}</span>
                            {call.duration && <span className="text-xs text-gray-400">· {formatDuration(call.duration)}</span>}
                            {call.participants.length > 0 && (
                              <span className="text-xs text-gray-400">· {call.participants.length} people</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-900 truncate font-medium">{call.title}</p>
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
                        {fetchingCallId === call.id ? (
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
                        )}
                      </button>
                    </div>
                    );
                  })}
                  {group.calls.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No recent calls found</p>
                  )}
                </div>
                {group.calls.length >= callLimit && (
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full mt-2 py-1.5 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
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
                )}
              </div>
            ))}
            <p className="text-xs text-gray-400 mt-2">Or paste a share link below.</p>
          </div>
        )}
      </div>

      {/* Connect modal */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Connect {providers.find((p) => p.slug === showConnectModal)?.name}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent mb-3 font-mono"
              autoFocus
            />

            {connectError && (
              <p className="text-sm text-red-600 mb-3">{connectError}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowConnectModal(null); setApiKeyInput(""); setConnectError(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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
