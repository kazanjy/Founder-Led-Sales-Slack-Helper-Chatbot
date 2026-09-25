"use client";

import { useEffect, useState } from "react";

interface Workspace {
  id: string;
  slackTeamName: string;
}

interface Channel {
  id: string;
  name: string;
}

interface Config {
  workspaceId: string | null;
  channelId: string | null;
  channelName: string | null;
  lastSentAt: string | null;
  workspace: { id: string; slackTeamName: string } | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

/**
 * Admin-only panel for the activity broadcast feature: pick a Slack
 * destination (workspace + public channel) and post a digest of recent
 * activity into it on demand. Persists into GlobalSettings.
 */
export default function ActivityBroadcastPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [sending, setSending] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Initial load — config + workspace list run together.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, wsRes] = await Promise.all([
          fetch("/api/admin/activity-broadcast/config"),
          fetch("/api/admin/workspaces?limit=100"),
        ]);
        if (cancelled) return;
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as Config;
          setConfig(cfg);
          setWorkspaceId(cfg.workspaceId ?? "");
          setChannelId(cfg.channelId ?? "");
        }
        if (wsRes.ok) {
          const data = await wsRes.json();
          setWorkspaces(data.workspaces || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load channels whenever the workspace selection changes.
  useEffect(() => {
    if (!workspaceId) {
      setChannels([]);
      return;
    }
    let cancelled = false;
    setChannelsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/admin/workspaces/${workspaceId}/channels`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setChannels(data.channels || []);
        } else {
          setChannels([]);
        }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleSave = async () => {
    setSavingConfig(true);
    setMessage(null);
    try {
      const channel = channels.find((c) => c.id === channelId);
      const res = await fetch("/api/admin/activity-broadcast/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceId || null,
          channelId: channelId || null,
          channelName: channel?.name ?? null,
        }),
      });
      if (res.ok) {
        const cfgRes = await fetch("/api/admin/activity-broadcast/config");
        if (cfgRes.ok) {
          setConfig((await cfgRes.json()) as Config);
        }
        setMessage({ type: "success", text: "Saved." });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleClear = async () => {
    setSavingConfig(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/activity-broadcast/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: null, channelId: null, channelName: null }),
      });
      if (res.ok) {
        setConfig((c) => c ? { ...c, workspaceId: null, channelId: null, channelName: null, workspace: null } : c);
        setWorkspaceId("");
        setChannelId("");
        setMessage({ type: "success", text: "Disabled." });
      } else {
        setMessage({ type: "error", text: "Failed to disable" });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/activity-broadcast/send", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setConfig((c) => c ? { ...c, lastSentAt: data.sentAtISO } : c);
        setMessage({
          type: "success",
          text: `Posted ${data.itemCount} action${data.itemCount === 1 ? "" : "s"} to #${data.channelName} in ${data.workspaceName}.`,
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send digest" });
      }
    } finally {
      setSending(false);
    }
  };

  const isConfigured = !!(config?.workspaceId && config?.channelId);
  const dirty = workspaceId !== (config?.workspaceId ?? "") || channelId !== (config?.channelId ?? "");

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 mb-4">
      <div className="px-4 py-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
              </svg>
              Slack Broadcast
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
              Post a digest of recent usage actions into a Slack channel you designate.
            </p>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${
              isConfigured
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            {isConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 sm:p-6">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => {
                    setWorkspaceId(e.target.value);
                    setChannelId("");
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">— Select a workspace —</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.slackTeamName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  Channel
                </label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  disabled={!workspaceId || channelsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="">
                    {workspaceId
                      ? channelsLoading
                        ? "Loading channels…"
                        : "— Select a channel —"
                      : "Pick a workspace first"}
                  </option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={savingConfig || !dirty || (!!workspaceId !== !!channelId)}
                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {savingConfig ? "Saving…" : "Save destination"}
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !isConfigured || dirty}
                title={
                  dirty
                    ? "Save destination changes first"
                    : !isConfigured
                      ? "Configure a destination first"
                      : "Post activity since the last send"
                }
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {sending ? "Posting…" : "Send digest now"}
              </button>
              {isConfigured && (
                <button
                  onClick={handleClear}
                  disabled={savingConfig}
                  className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md font-medium disabled:opacity-50"
                >
                  Disable
                </button>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                Last sent: {formatRelative(config?.lastSentAt ?? null)}
                {config?.lastSentAt ? " PT" : ""}
              </span>
            </div>

            {message && (
              <div
                className={`mt-3 text-sm px-3 py-2 rounded-md ${
                  message.type === "success"
                    ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                    : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                }`}
              >
                {message.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
