"use client";

import { useState } from "react";
import SalesNavBar from "@/components/SalesNavBar";

/**
 * Test surface for the GTM "everything else" agent. Drop into the
 * URL bar at /agents/gtm. Mirrors /agents/deals and /agents/coaching.
 */

interface ToolCallTrace {
  name: string;
  argsJson: string;
  durationMs: number;
  resultPreview: string;
  error?: string;
}

interface AgentResponse {
  reply: string;
  turns: number;
  hitTurnCap: boolean;
  trace: ToolCallTrace[];
  totalMs: number;
}

export default function GtmAgentTestPage() {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/agents/gtm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResponse(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">🧪 GTM Agent — Test Surface</h1>
          <p className="text-sm text-gray-500">
            The "everything else" agent. Mixes personal GTM artifacts with playbook RAG. Try: "What's MEDDICC?", "What's our value prop?", "How should I handle a pricing objection?", "Where should I focus this week?"
          </p>
        </header>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything — Cmd+Enter to send"
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-gray-400">Cmd/Ctrl+Enter to send</p>
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {sending ? "Thinking…" : "Ask"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {response && (
          <>
            <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-2">
                Reply · {response.turns} turn{response.turns === 1 ? "" : "s"} · {response.totalMs}ms
                {response.hitTurnCap && " · ⚠ hit turn cap"}
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{response.reply}</div>
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-2">
                Tool call trace ({response.trace.length})
              </div>
              {response.trace.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No tools called — answered from training.</p>
              ) : (
                <ol className="space-y-2">
                  {response.trace.map((t, i) => (
                    <li key={i} className="border border-gray-100 rounded-md p-2 text-xs">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <code className="font-semibold text-purple-700">{t.name}</code>
                        <span className="text-gray-400">{t.durationMs}ms{t.error ? " · error" : ""}</span>
                      </div>
                      <div className="text-gray-500 mb-1">
                        args: <code className="text-gray-700">{t.argsJson}</code>
                      </div>
                      <div className="text-gray-500 break-all">
                        → <code className="text-gray-700">{t.resultPreview}</code>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
