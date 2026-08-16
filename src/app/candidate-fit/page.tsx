"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import SalesNavBar from "@/components/SalesNavBar";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { CandidateFitReport, type FitReport } from "@/components/hiring/CandidateFitReport";

interface AssessmentRow {
  id: string;
  candidateName: string;
  linkedinUrl: string | null;
  roleLabel: string;
  source: string;
  verdict: string;
  createdAt: string;
  user?: { id: string; name: string | null; email: string | null };
}

const ROLES = ["AE", "SDR", "AM", "CSM", "Manager", "VP"];

const VERDICT_DOT: Record<string, string> = {
  strong_fit: "bg-emerald-500",
  worth_a_look: "bg-blue-500",
  stretch: "bg-amber-500",
  likely_mismatch: "bg-rose-500",
};

const PROGRESS_MESSAGES = [
  "Reading their work history",
  "Reconstructing what each company was at the time",
  "Checking funding data where the read is thin",
  "Running the flag rules over the timeline",
  "Grading against your hiring bar",
];

export default function CandidateFitPage() {
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [profileText, setProfileText] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [roleLabel, setRoleLabel] = useState("AE");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FitReport | null>(null);
  const [meta, setMeta] = useState<{ source?: string; pdlCallsUsed?: number } | null>(null);

  const [history, setHistory] = useState<AssessmentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/candidate-fit");
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.assessments || []);
    } catch {
      /* the list is a convenience; a failure here shouldn't block a run */
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const run = async () => {
    if (!linkedinUrl.trim() && !profileText.trim() && !file) {
      setError("Give me a LinkedIn URL, or paste / drop a résumé — I need one or the other.");
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    setSelectedId(null);
    try {
      const form = new FormData();
      form.append("linkedinUrl", linkedinUrl);
      form.append("profileText", profileText);
      form.append("candidateName", candidateName);
      form.append("roleLabel", roleLabel);
      if (file) form.append("file", file);

      const res = await fetch("/api/candidate-fit", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assessment failed.");
      setReport(data.report);
      setMeta({ source: data.source, pdlCallsUsed: data.pdlCallsUsed });
      setSelectedId(data.id);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed.");
    } finally {
      setRunning(false);
    }
  };

  const openStored = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/candidate-fit/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load that assessment.");
      setReport(data.assessment.assessment);
      setMeta({ source: data.assessment.source });
      setSelectedId(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that assessment.");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />
      <GeneratingOverlay
        visible={running}
        title="Assessing the candidate"
        subtitle="Reconstructing what each company was while they were there"
        emojis={["🔎", "📊", "🧭"]}
        messages={PROGRESS_MESSAGES}
      />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔎 Candidate Fit</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Screen a candidate against your own hiring bar. Reconstructs what each company on their résumé{" "}
            <em>was</em> while they worked there — stage, headcount, motion, who they sold to — then runs
            deterministic flag rules over the timeline.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 sticky top-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                LinkedIn URL
              </label>
              <input
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/janedoe"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-100 text-sm"
              />

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                  <select
                    value={roleLabel}
                    onChange={(e) => setRoleLabel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-100 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Name <span className="text-gray-400 font-normal">(opt.)</span>
                  </label>
                  <input
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
              </div>
              {/* The threshold is role-relative, and saying so beats
                  having the founder wonder why an AE wasn't flagged. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Role sets the bar: a short stint is under 12mo for an SDR, 18mo for an AE, 24mo for a VP.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`mt-4 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  dragging
                    ? "border-purple-500 bg-purple-50 dark:bg-purple-950"
                    : "border-gray-300 dark:border-gray-600 hover:border-purple-400"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <div className="text-sm">
                    <p className="text-gray-900 dark:text-gray-100 font-medium">📄 {file.name}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="text-xs text-gray-500 hover:text-rose-600 mt-1"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Drop a résumé or LinkedIn PDF export
                    <br />
                    <span className="text-xs">or click to browse</span>
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                A résumé usually carries quota, attainment and self-sourced numbers the LinkedIn profile
                doesn&apos;t. Worth adding even with a URL.
              </p>

              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 mt-4">
                Or paste profile / résumé text
              </label>
              <textarea
                value={profileText}
                onChange={(e) => setProfileText(e.target.value)}
                rows={5}
                placeholder="Paste their LinkedIn profile or résumé…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-gray-100 text-sm"
              />

              <button
                onClick={run}
                disabled={running}
                className="w-full mt-4 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                {running ? "Assessing…" : "Assess candidate"}
              </button>

              {error && (
                <div className="mt-3 text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Report + history */}
          <div className="lg:col-span-2">
            {report ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {report.candidate?.name || "Candidate"}
                    </h2>
                    {report.candidate?.headline && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">{report.candidate.headline}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    source: {meta?.source || report.candidate?.source}
                    {meta?.pdlCallsUsed != null && ` · ${meta.pdlCallsUsed} PDL call(s)`}
                  </p>
                </div>
                <CandidateFitReport report={report} />
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                  Drop in a LinkedIn URL or a résumé and hit assess.
                </p>
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                  Previously assessed ({history.length})
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => openStored(h.id)}
                      className={`w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 -mx-2 rounded ${
                        selectedId === h.id ? "bg-purple-50 dark:bg-purple-950/40" : ""
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${VERDICT_DOT[h.verdict] || "bg-gray-400"}`} />
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        {h.candidateName}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{h.roleLabel}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
