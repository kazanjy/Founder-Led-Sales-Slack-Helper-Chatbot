"use client";

import { useEffect, useState } from "react";

interface LabelRow {
  label: string;
  calls: number;
  cost: number;
  costPerCall: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheHitPct: number;
  failures: number;
  p50Ms: number;
  maxMs: number;
}

interface SpendData {
  days: number;
  total: { calls: number; cost: number; failures: number };
  byModel: { model: string; calls: number; cost: number }[];
  byLabel: LabelRow[];
}

const WINDOWS = [1, 7, 30];

const usd = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0";

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export default function AdminLlmSpendPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<SpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"cost" | "calls">("cost");

  useEffect(() => {
    document.title = "Admin - LLM Spend";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/llm-spend?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Sorting is client-side on purpose: the route already returns the
  // whole (capped) label list, and cost order vs call order is the
  // comparison worth making, so re-fetching to flip it would be silly.
  const rows = data
    ? [...data.byLabel].sort((a, b) => (sortBy === "cost" ? b.cost - a.cost : b.calls - a.calls))
    : [];
  const maxCost = rows.reduce((m, r) => Math.max(m, r.cost), 0);
  const maxCalls = rows.reduce((m, r) => Math.max(m, r.calls), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">LLM Spend</h1>
        <div className="flex gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
          {WINDOWS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                days === d
                  ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* The prices behind these dollar figures are seed values. Saying so
          here is cheaper than someone making a budget decision on them. */}
      <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-6">
        Dollar figures use a seed price map and are indicative. Token counts are measured and
        exact — rank by those when the gap matters.
      </p>

      {loading && <div className="text-gray-500 dark:text-gray-400">Loading spend data...</div>}

      {!loading && !data && (
        <div className="text-gray-500 dark:text-gray-400">
          Couldn&rsquo;t load spend data. If the <code>llm_calls</code> table hasn&rsquo;t been
          created yet, run the migration first.
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Total cost
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {usd(data.total.cost)}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Calls
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {data.total.calls.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Avg per call
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {usd(data.total.calls ? data.total.cost / data.total.calls : 0)}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Failed calls
              </div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  data.total.failures > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {data.total.failures.toLocaleString()}
              </div>
              {data.total.failures > 0 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  billed input, no output
                </div>
              )}
            </div>
          </div>

          {data.byModel.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                By model
              </h2>
              <div className="flex flex-wrap gap-3">
                {data.byModel.map((m) => (
                  <div
                    key={m.model}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2"
                  >
                    <div className="text-sm font-mono text-gray-900 dark:text-gray-100">
                      {m.model}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {usd(m.cost)} · {m.calls.toLocaleString()} calls
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">By feature</h2>
            <div className="flex gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">Rank by</span>
              {(["cost", "calls"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={`font-medium ${
                    sortBy === k
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No calls recorded in this window yet.
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                  <tr className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="text-left font-semibold px-4 py-2">Feature</th>
                    <th className="text-right font-semibold px-4 py-2">Cost</th>
                    <th className="text-right font-semibold px-4 py-2">Calls</th>
                    <th className="text-right font-semibold px-4 py-2">Per call</th>
                    <th className="text-right font-semibold px-4 py-2">In</th>
                    <th className="text-right font-semibold px-4 py-2">Out</th>
                    <th className="text-right font-semibold px-4 py-2">Cached</th>
                    <th className="text-right font-semibold px-4 py-2">p50</th>
                    <th className="text-right font-semibold px-4 py-2">Max</th>
                    <th className="text-right font-semibold px-4 py-2">Fails</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rows.map((r) => {
                    const share =
                      sortBy === "cost"
                        ? maxCost > 0
                          ? (r.cost / maxCost) * 100
                          : 0
                        : maxCalls > 0
                          ? (r.calls / maxCalls) * 100
                          : 0;
                    return (
                      <tr key={r.label} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-2 relative">
                          {/* A bar behind the label, so the shape of the
                              spend reads at a glance without a chart lib. */}
                          <div
                            className="absolute inset-y-0 left-0 bg-blue-50 dark:bg-blue-900/20 pointer-events-none"
                            style={{ width: `${share}%` }}
                          />
                          <span className="relative font-mono text-xs text-gray-900 dark:text-gray-100">
                            {r.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {usd(r.cost)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {r.calls.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {usd(r.costPerCall)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {tokens(r.promptTokens)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {tokens(r.completionTokens)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right whitespace-nowrap ${
                            r.promptTokens > 100_000 && r.cacheHitPct < 10
                              ? "text-amber-600 dark:text-amber-400 font-medium"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                          title="Share of input tokens served from cache. Low, on a repeat-heavy caller, is a cost lever."
                        >
                          {Math.round(r.cacheHitPct)}%
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {secs(r.p50Ms)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {secs(r.maxMs)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right whitespace-nowrap ${
                            r.failures > 0
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                        >
                          {r.failures || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
            Features are attributed from the call stack. <code>unknown</code> means the frame
            wasn&rsquo;t recognised, not that the call was untracked.
          </p>
        </>
      )}
    </div>
  );
}
