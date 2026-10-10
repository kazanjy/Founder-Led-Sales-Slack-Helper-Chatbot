"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";

interface DealInput {
  id: string;
  calls: CallInput[];
}

interface CallInput {
  id: string;
  summary: string;
  transcript: string;
  recordingUrl: string;
}

let nextId = 1;
function genId() { return `local_${nextId++}`; }

function createCall(): CallInput {
  return { id: genId(), summary: "", transcript: "", recordingUrl: "" };
}

function createDeal(): DealInput {
  return { id: genId(), calls: [createCall(), createCall()] };
}

export default function NewSalesMotion() {
  const router = useRouter();
  const [deals, setDeals] = useState<DealInput[]>([createDeal(), createDeal()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingForCall, setImportingForCall] = useState<{ dealId: string; callId: string } | null>(null);

  useEffect(() => {
    document.title = "Analyze Sales Motion - Mikey";
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      if (!d.user) router.push("/?error=not_logged_in");
    }).catch(() => router.push("/?error=not_logged_in"));
  }, [router]);

  const addDeal = () => setDeals([...deals, createDeal()]);

  const removeDeal = (dealId: string) => {
    if (deals.length <= 1) return;
    setDeals(deals.filter((d) => d.id !== dealId));
  };

  const addCall = (dealId: string) => {
    setDeals(deals.map((d) =>
      d.id === dealId ? { ...d, calls: [...d.calls, createCall()] } : d
    ));
  };

  const removeCall = (dealId: string, callId: string) => {
    setDeals(deals.map((d) => {
      if (d.id !== dealId) return d;
      if (d.calls.length <= 1) return d;
      return { ...d, calls: d.calls.filter((c) => c.id !== callId) };
    }));
  };

  const updateCall = (dealId: string, callId: string, field: "summary" | "transcript" | "recordingUrl", value: string) => {
    setDeals(deals.map((d) => {
      if (d.id !== dealId) return d;
      return {
        ...d,
        calls: d.calls.map((c) =>
          c.id === callId ? { ...c, [field]: value } : c
        ),
      };
    }));
  };

  const hasContent = deals.some((d) => d.calls.some((c) => c.summary.trim() || c.transcript.trim()));

  const handleAnalyze = async () => {
    if (!hasContent) return;
    setSaving(true);
    setError(null);

    try {
      // 1. Create collection
      const colRes = await fetch("/api/sales-motion/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!colRes.ok) throw new Error("Failed to create collection");
      const { collection } = await colRes.json();

      // 2. Create deals and calls
      for (let di = 0; di < deals.length; di++) {
        const deal = deals[di];
        const dealRes = await fetch("/api/sales-motion/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collection.id, dealOrder: di }),
        });
        if (!dealRes.ok) throw new Error("Failed to create deal");
        const { deal: savedDeal } = await dealRes.json();

        // Create calls in parallel
        await Promise.all(deal.calls.map(async (call, ci) => {
          if (!call.summary.trim() && !call.transcript.trim()) return;
          await fetch("/api/sales-motion/calls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dealId: savedDeal.id,
              summary: call.summary.trim() || undefined,
              transcript: call.transcript.trim() || undefined,
              recordingUrl: call.recordingUrl.trim() || undefined,
              callOrder: ci,
            }),
          });
        }));
      }

      // 3. Navigate to view page to start analysis
      router.push(`/sales-motion?analyzing=true&collectionId=${collection.id}`);
    } catch (err) {
      console.error("Error saving:", err);
      setError(err instanceof Error ? err.message : "Failed to save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Analyze Your Sales Motion</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Provide 3-5 of your best <strong className="text-gray-900 dark:text-gray-100">closed-won deals</strong>. For each deal, paste <strong className="text-gray-900 dark:text-gray-100">all the calls</strong> from
            first touch through close &mdash; summaries and transcripts from your call recorder in chronological order.
          </p>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-blue-800 font-medium">Focus on &ldquo;good to great&rdquo; closed-won deals</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Pick <strong>won deals</strong> that represent how you want your sales process to work. Include <strong>every call</strong> in
                each deal &mdash; discovery, demo, proposal, negotiation, close. Mikey will synthesize these into a prototypical
                sales motion and canonical call scripts for each stage.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="space-y-8">
          {deals.map((deal, dealIndex) => (
            <div key={deal.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-6 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Deal {dealIndex + 1}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{deal.calls.length} call{deal.calls.length !== 1 ? "s" : ""}</span>
                  {deals.length > 1 && (
                    <button
                      onClick={() => removeDeal(deal.id)}
                      className="text-red-400 hover:text-red-600 p-1"
                      title="Remove deal"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-6">
                {deal.calls.map((call, callIndex) => (
                  <div key={call.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Call {callIndex + 1}</h3>
                        <button
                          type="button"
                          onClick={() => setImportingForCall({ dealId: deal.id, callId: call.id })}
                          className="flex items-center gap-1 px-2 py-0.5 text-xs text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors border border-purple-200"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                          Import
                        </button>
                      </div>
                      {deal.calls.length > 1 && (
                        <button
                          onClick={() => removeCall(deal.id, call.id)}
                          className="text-gray-400 hover:text-red-500 p-1"
                          title="Remove call"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Call Summary
                        </label>
                        <textarea
                          value={call.summary}
                          onChange={(e) => updateCall(deal.id, call.id, "summary", e.target.value)}
                          placeholder="Paste the call summary from your call recorder..."
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Full Transcript <span className="text-gray-400">(optional but recommended)</span>
                        </label>
                        <textarea
                          value={call.transcript}
                          onChange={(e) => updateCall(deal.id, call.id, "transcript", e.target.value)}
                          placeholder="Paste the full call transcript..."
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Recording URL <span className="text-gray-400">(optional — Fathom, Gong, Chorus, etc.)</span>
                        </label>
                        <input
                          type="url"
                          value={call.recordingUrl}
                          onChange={(e) => updateCall(deal.id, call.id, "recordingUrl", e.target.value)}
                          placeholder="https://fathom.video/share/..."
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => addCall(deal.id)}
                  className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:border-purple-400 hover:text-purple-600 transition-colors"
                >
                  + Add Call
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={addDeal}
            className="px-5 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            + Add Deal
          </button>
          <button
            onClick={handleAnalyze}
            disabled={saving || !hasContent}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Analyze Sales Motion
              </>
            )}
          </button>
        </div>

        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">Best results come from 3-5 complete deals</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Include every call in each deal&apos;s sequence &mdash; from first discovery through close. The more complete the picture, the better Mikey can synthesize your prototypical sales motion and create canonical call scripts.
            </p>
          </div>
        </div>
      </div>

      {/* Import from Meeting Recorder Modal */}
      {importingForCall && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setImportingForCall(null); }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import from Meeting Recorder</h3>
              <button onClick={() => setImportingForCall(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <MeetingRecorderPanel
              onSelectCall={(data) => {
                const headerLines: string[] = [];
                if (data.date) {
                  headerLines.push(`Call Date: ${new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
                }
                if (data.attendees?.length) {
                  const formatted = data.attendees.map((a) => {
                    const parts = [a.name];
                    if (a.title) parts[0] += `, ${a.title}`;
                    if (a.company) parts[0] += ` @ ${a.company}`;
                    if (a.email) parts.push(a.email);
                    return parts.join(" — ");
                  });
                  headerLines.push(`Attendees:\n${formatted.map((f) => `  - ${f}`).join("\n")}`);
                }
                const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";

                const { dealId, callId } = importingForCall;
                setDeals((prev) => prev.map((d) => {
                  if (d.id !== dealId) return d;
                  return {
                    ...d,
                    calls: d.calls.map((c) => {
                      if (c.id !== callId) return c;
                      return {
                        ...c,
                        summary: data.summary ? header + data.summary : c.summary,
                        transcript: data.transcript || c.transcript,
                        recordingUrl: data.recordingUrl || c.recordingUrl,
                      };
                    }),
                  };
                }));
                setImportingForCall(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
