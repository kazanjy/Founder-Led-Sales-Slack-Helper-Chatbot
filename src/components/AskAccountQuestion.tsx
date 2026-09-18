"use client";

import { useState } from "react";

interface Stats {
  users: number;
  gtmVariables: number;
  maturityAssessments: number;
  readinessItems: number;
  coachingSessions: number;
  coachingSessionsWithTranscripts: number;
  coachingGoals: number;
  coachingTasks: number;
  salesAssets: number;
  totalChars: number;
  maturityStage: string | null;
  readinessByStatus: Record<string, number>;
}

interface AskResult {
  question: string;
  answer: string;
  stats: Stats;
  truncations: string[];
  askedAt: string;
}

interface AskAccountQuestionProps {
  scope: "account" | "user";
  targetId: string;
  /** Display name for the target — shown in the panel heading. */
  targetLabel?: string;
}

function StatLine({ stats }: { stats: Stats }) {
  const readinessParts = Object.entries(stats.readinessByStatus)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k.replace("_", " ")}`)
    .join(" / ");
  return (
    <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
      <div>
        {stats.coachingSessions} coaching sessions ({stats.coachingSessionsWithTranscripts} with transcripts) ·{" "}
        {stats.coachingGoals} goals · {stats.coachingTasks} tasks · {stats.salesAssets} assets ·{" "}
        {stats.gtmVariables} GTM vars
      </div>
      <div>
        Maturity: {stats.maturityStage || "—"} ({stats.maturityAssessments} assessments)
        {readinessParts ? ` · Readiness: ${readinessParts}` : ""}
      </div>
      <div>≈ {stats.totalChars.toLocaleString()} chars in context</div>
    </div>
  );
}

/**
 * Admin-only "Ask This Account a Question" panel. Bundles the
 * account/user context and routes a single-shot question to GPT-5
 * via /api/admin/account-context/ask. Shows the rolling history of
 * Q→A pairs in this session (client-side only — not persisted).
 */
export default function AskAccountQuestion({ scope, targetId, targetLabel }: AskAccountQuestionProps) {
  const [question, setQuestion] = useState("");
  const [results, setResults] = useState<AskResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/account-context/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, targetId, question: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to get an answer");
      } else {
        setResults((prev) => [
          {
            question: q,
            answer: data.answer,
            stats: data.stats,
            truncations: data.truncations || [],
            askedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setQuestion("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 mb-6">
      <div className="px-4 py-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Ask This {scope === "account" ? "Account" : "User"} a Question
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
          Routes a single-shot query to GPT-5 with{" "}
          {targetLabel ? <strong>{targetLabel}</strong> : "this " + scope}'s context preloaded — GTM
          variables, maturity, readiness, coaching, and sales assets. No impersonation needed.
        </p>
      </div>

      <div className="px-4 py-4 sm:p-6 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleAsk();
            }
          }}
          placeholder={`e.g. "What's blocking this ${scope} from getting to repeatable revenue?"`}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleAsk}
            disabled={busy || !question.trim()}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {busy ? "Asking GPT-5…" : "Ask"}
          </button>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">⌘↵ to send</span>
        </div>
        {error && (
          <div className="text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-md">
            {error}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="px-4 py-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 space-y-6">
          {results.map((r, i) => (
            <div key={`${r.askedAt}-${i}`} className="space-y-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(r.askedAt).toLocaleTimeString()}
              </div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Q: {r.question}
              </div>
              <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {r.answer}
              </div>
              <details className="text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                  Context loaded
                </summary>
                <div className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
                  <StatLine stats={r.stats} />
                  {r.truncations.length > 0 && (
                    <div className="mt-1 text-amber-600 dark:text-amber-400">
                      Truncations: {r.truncations.join("; ")}
                    </div>
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
