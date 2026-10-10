"use client";

import { useCallback, useEffect, useState } from "react";

interface Candidate {
  providerCallId: string;
  title: string;
  date: string;
  durationMin: number | null;
  attendees: { name: string; email?: string }[];
  matchedDomains: string[];
  status: "new" | "already_imported";
}

interface CandidatesResponse {
  candidates: Candidate[];
  oldestScannedDate: string | null;
  hitCeiling: boolean;
  totalScanned: number;
  provider: string | null;
  sinceCutoff: string;
}

interface ImportResponse {
  imported: number;
  skipped: number;
  failed: number;
  oldestImportedDate: string | null;
  newestImportedDate: string | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BulkImportCallsModal({
  open,
  onClose,
  dealId,
  dealName,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  dealId: string;
  dealName: string;
  onImported: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/bulk-import-calls/candidates`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Scan failed (${res.status})`);
      }
      const json: CandidatesResponse = await res.json();
      setData(json);
      // Default selection: all "new" candidates checked.
      setSelected(new Set(json.candidates.filter((c) => c.status === "new").map((c) => c.providerCallId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (open && !data && !loading) loadCandidates();
  }, [open, data, loading, loadCandidates]);

  useEffect(() => {
    if (!open) {
      // Reset on close so a fresh scan runs next open
      setData(null);
      setSelected(new Set());
      setImportResult(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllNew = () => {
    if (!data) return;
    setSelected(new Set(data.candidates.filter((c) => c.status === "new").map((c) => c.providerCallId)));
  };

  const selectNone = () => setSelected(new Set());

  const doImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/bulk-import-calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Import failed (${res.status})`);
      }
      const json: ImportResponse = await res.json();
      setImportResult(json);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">📞 Bulk Import Calls</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Scanning the last 90 days for calls with attendees matching <span className="font-medium">{dealName}</span>.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-3 text-sm text-gray-500">
              <svg className="animate-spin h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scanning your recorder for matching calls…
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          {!loading && data && !importResult && (
            <>
              {/* Scan summary */}
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 rounded-lg p-3 mb-4 text-xs text-purple-800 dark:text-purple-200">
                Scanned <strong>{data.totalScanned}</strong> {data.provider ? data.provider : "recorder"} call
                {data.totalScanned === 1 ? "" : "s"}{" "}
                {data.oldestScannedDate ? <>back to <strong>{fmtDate(data.oldestScannedDate)}</strong></> : null}.
                Found <strong>{data.candidates.length}</strong> matching this deal.
                {data.hitCeiling && (
                  <div className="mt-1 text-amber-700 dark:text-amber-300">
                    ⚠ Hit the 250-call scan ceiling — may not have reached the full 90-day window.
                  </div>
                )}
                {!data.provider && (
                  <div className="mt-1 text-red-700 dark:text-red-300">No active recorder connection found.</div>
                )}
              </div>

              {data.candidates.length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-12">
                  No calls in the last 90 days match this deal&apos;s domain or participants.
                </div>
              ) : (
                <>
                  {/* Selection toolbar */}
                  <div className="flex items-center justify-between mb-2 text-xs">
                    <div className="flex items-center gap-3">
                      <button onClick={selectAllNew} className="text-purple-600 hover:text-purple-800 font-medium">Select all new</button>
                      <span className="text-gray-300">·</span>
                      <button onClick={selectNone} className="text-gray-500 hover:text-gray-700 font-medium">Select none</button>
                    </div>
                    <span className="text-gray-500">{selected.size} of {data.candidates.filter((c) => c.status === "new").length} selected</span>
                  </div>

                  {/* Candidates list */}
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {data.candidates.map((c) => {
                      const isSelected = selected.has(c.providerCallId);
                      const isImported = c.status === "already_imported";
                      return (
                        <label
                          key={c.providerCallId}
                          className={`flex items-start gap-3 px-3 py-2.5 ${isImported ? "bg-gray-50 dark:bg-gray-800/40" : "cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-900/10"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isImported}
                            onChange={() => !isImported && toggle(c.providerCallId)}
                            className="mt-1 w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500 disabled:opacity-40"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${isImported ? "text-gray-400 line-through" : "text-gray-900 dark:text-gray-100"}`}>
                                {c.title}
                              </span>
                              {isImported && (
                                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Already imported</span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {fmtDate(c.date)}
                              {c.durationMin ? ` · ${c.durationMin} min` : ""}
                              {c.attendees.length > 0 && ` · ${c.attendees.slice(0, 3).map((a) => a.name).join(", ")}${c.attendees.length > 3 ? ` +${c.attendees.length - 3}` : ""}`}
                            </div>
                            <div className="text-[10px] text-purple-600 dark:text-purple-300 mt-0.5">
                              Matched: {c.matchedDomains.join(", ")}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* Result */}
          {importResult && (
            <div className="py-8 text-center space-y-2">
              <div className="text-3xl">✅</div>
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Imported {importResult.imported} call{importResult.imported === 1 ? "" : "s"}
              </div>
              {importResult.oldestImportedDate && importResult.newestImportedDate && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {importResult.oldestImportedDate === importResult.newestImportedDate
                    ? <>From <strong>{fmtDate(importResult.oldestImportedDate)}</strong></>
                    : <>From <strong>{fmtDate(importResult.oldestImportedDate)}</strong> to <strong>{fmtDate(importResult.newestImportedDate)}</strong></>
                  }
                </div>
              )}
              {(importResult.skipped > 0 || importResult.failed > 0) && (
                <div className="text-xs text-gray-400">
                  {importResult.skipped > 0 && <>{importResult.skipped} skipped (already imported)</>}
                  {importResult.skipped > 0 && importResult.failed > 0 && " · "}
                  {importResult.failed > 0 && <>{importResult.failed} failed</>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 font-medium px-4 py-2"
          >
            {importResult ? "Close" : "Cancel"}
          </button>
          {!importResult && (
            <button
              onClick={doImport}
              disabled={selected.size === 0 || importing || loading}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2"
            >
              {importing && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {importing ? "Importing…" : `Import ${selected.size} call${selected.size === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
