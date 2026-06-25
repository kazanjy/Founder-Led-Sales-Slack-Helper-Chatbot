"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface RecorderProvider {
  slug: string;
  name: string;
  connected: boolean;
}

interface RecorderConnection {
  id: string;
  provider: string;
  status: string;
  lastSyncedAt: string | null;
}

interface AuthMe {
  user: {
    email: string | null;
    googleCalendarConnected?: boolean;
  } | null;
}

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold text-gray-900">🔌 Integrations</h1>
            <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
          </div>
          <p className="text-sm text-gray-500">
            Connect your call recorder and calendar so Mikey can pull in calls and meetings automatically.
          </p>
        </header>

        <div className="space-y-4">
          <MeetingRecorderCard />
          <GoogleCalendarCard />
        </div>
      </main>
    </div>
  );
}

function MeetingRecorderCard() {
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<RecorderProvider[]>([]);
  const [connections, setConnections] = useState<RecorderConnection[]>([]);
  const [showConnect, setShowConnect] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meeting-recorder/connections");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.available || []);
        setConnections(data.connections || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = async () => {
    if (!showConnect || !apiKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/meeting-recorder/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: showConnect, apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't connect with that API key.");
        return;
      }
      setShowConnect(null);
      setApiKey("");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!window.confirm("Disconnect this recorder? You can reconnect anytime.")) return;
    await fetch(`/api/meeting-recorder/connections/${connectionId}`, { method: "DELETE" });
    await load();
  };

  const activeConn = connections.find((c) => c.status === "active");
  const activeProvider = activeConn ? providers.find((p) => p.slug === activeConn.provider) : null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">🎙️ Meeting Recorder</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Granola, Fathom, or Fireflies. Mikey pulls recent calls every hour and attaches them to matching deals.
          </p>
        </div>
        {activeConn && (
          <StatusBadge connected />
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : activeConn ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm">
          <div>
            <span className="font-medium text-green-800">Connected — {activeProvider?.name || activeConn.provider}</span>
            {activeConn.lastSyncedAt && (
              <span className="text-xs text-green-700 ml-2">
                Last synced {new Date(activeConn.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={() => handleDisconnect(activeConn.id)}
            className="text-xs text-gray-600 hover:text-red-600 hover:underline"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <button
              key={p.slug}
              onClick={() => {
                setShowConnect(p.slug);
                setApiKey("");
                setError(null);
              }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
            >
              Connect {p.name}
            </button>
          ))}
        </div>
      )}

      {showConnect && (
        <ApiKeyModal
          providerName={providers.find((p) => p.slug === showConnect)?.name || showConnect}
          apiKey={apiKey}
          setApiKey={setApiKey}
          onCancel={() => {
            setShowConnect(null);
            setApiKey("");
            setError(null);
          }}
          onSubmit={handleConnect}
          submitting={submitting}
          error={error}
        />
      )}
    </section>
  );
}

function GoogleCalendarCard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<AuthMe["user"]>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data: AuthMe = await res.json();
        setMe(data.user);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect Google Calendar? Mikey will stop reading your calendar until you reconnect.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/google-calendar/disconnect", { method: "POST" });
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = !!me?.googleCalendarConnected;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">📅 Google Calendar</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Pulls upcoming meetings into deals and powers the daily pre-call research briefs.
          </p>
        </div>
        {connected && <StatusBadge connected />}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : connected ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm">
          <span className="font-medium text-green-800">
            Connected{me?.email ? ` — ${me.email}` : ""}
          </span>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-xs text-gray-600 hover:text-red-600 hover:underline disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <a
          href="/api/auth/google?returnTo=/integrations"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Connect Google Calendar
        </a>
      )}
    </section>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-gray-400"}`} />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function ApiKeyModal({
  providerName,
  apiKey,
  setApiKey,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  providerName: string;
  apiKey: string;
  setApiKey: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Connect {providerName}</h3>
        <p className="text-xs text-gray-500 mb-3">
          Paste your API key. You can find it in your {providerName} account settings.
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent mb-2"
          autoFocus
        />
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || !apiKey.trim()}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            {submitting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
