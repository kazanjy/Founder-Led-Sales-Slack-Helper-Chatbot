"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";

export default function NewCallRecap() {
  const router = useRouter();
  const [recordingUrl, setRecordingUrl] = useState("");
  const [callSummary, setCallSummary] = useState("");
  const [callTranscript, setCallTranscript] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [toneGuidance, setToneGuidance] = useState("");
  const [toneLoaded, setToneLoaded] = useState(false);
  const [toneSaving, setToneSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Auto-extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);
  const extractAttemptedRef = useRef<string | null>(null);
  const callSummaryRef = useRef<HTMLTextAreaElement>(null);

  // Source freshness
  const [narrativeDate, setNarrativeDate] = useState<string | null>(null);
  const [salesMotionDate, setSalesMotionDate] = useState<string | null>(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    document.title = "Call Recap Email - Mikey";
  }, []);

  // Load saved tone guidance
  useEffect(() => {
    async function loadTone() {
      try {
        const res = await fetch("/api/call-recap/tone");
        if (res.ok) {
          const data = await res.json();
          if (data.value) setToneGuidance(data.value);
        }
      } catch { /* ignore */ }
      setToneLoaded(true);
    }
    loadTone();
  }, []);

  // Save tone guidance on blur
  const saveToneGuidance = async () => {
    setToneSaving(true);
    try {
      await fetch("/api/call-recap/tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: toneGuidance.trim() }),
      });
    } catch { /* ignore */ }
    setToneSaving(false);
  };

  // Auto-extract transcript when a valid recording URL is pasted
  useEffect(() => {
    const url = recordingUrl.trim();
    if (!url || extracting || extractAttemptedRef.current === url) return;
    try { new URL(url); } catch { return; }
    if (callTranscript.trim().length > 100) return;

    extractAttemptedRef.current = url;
    setExtracting(true);
    setExtractionMessage("Extracting transcript from recording...");

    fetch("/api/call-review/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.transcript) {
          setCallTranscript(data.transcript);
          setExtractionMessage(`Transcript extracted from ${data.vendor || "recording"} (${data.transcript.length.toLocaleString()} chars)`);
        } else {
          setExtractionMessage(data.manualInstructions || data.error || "Could not auto-extract. Please paste the transcript manually.");
        }
      })
      .catch(() => {
        setExtractionMessage("Could not auto-extract. Please paste the transcript manually.");
      })
      .finally(() => {
        setExtracting(false);
      });
  }, [recordingUrl, extracting, callTranscript]);

  useEffect(() => {
    async function checkSources() {
      try {
        const [narRes, motionRes] = await Promise.all([
          fetch("/api/sales-narrative/latest"),
          fetch("/api/sales-motion/latest"),
        ]);
        if (narRes.ok) {
          const d = await narRes.json();
          if (d.hasNarrative && d.version?.createdAt) setNarrativeDate(d.version.createdAt);
        }
        if (motionRes.ok) {
          const d = await motionRes.json();
          if (d.hasCollection && d.collection?.createdAt) setSalesMotionDate(d.collection.createdAt);
        }
      } catch { /* ignore */ }
      setSourcesLoaded(true);
    }
    checkSources();
  }, []);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const canGenerate = recordingUrl.trim() && callSummary.trim() && !generating;

  const handleGenerate = () => {
    if (!canGenerate) return;
    // Store inputs in sessionStorage for the view page to pick up
    try {
      sessionStorage.setItem("callRecapInput", JSON.stringify({
        recordingUrl: recordingUrl.trim(),
        callSummary: callSummary.trim(),
        callTranscript: callTranscript.trim() || undefined,
        customNotes: customNotes.trim() || undefined,
        toneGuidance: toneGuidance.trim() || undefined,
      }));
    } catch { /* ignore */ }
    router.push("/call-recap?generating=true");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
        <div className="w-full max-w-3xl px-6 py-8">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Generate Call Recap Email
            </h1>
            <p className="text-gray-500 mb-6">
              Paste your call details and Mikey will generate a professional follow-up email with the right next steps for your sales motion.
            </p>

            {/* Source freshness panel */}
            <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
              <h3 className="text-sm font-semibold text-amber-900 mb-3">Context sources for smarter emails</h3>
              {!sourcesLoaded ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-amber-200 rounded-full animate-pulse" />
                    <div className="h-4 w-32 bg-amber-100 rounded animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-amber-200 rounded-full animate-pulse" />
                    <div className="h-4 w-28 bg-amber-100 rounded animate-pulse" />
                  </div>
                </div>
              ) : (
                <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {narrativeDate ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className="text-sm text-gray-700">Sales Narrative</span>
                      {narrativeDate && <span className="text-xs text-gray-400">{formatDate(narrativeDate)}</span>}
                    </div>
                    <a href={narrativeDate ? "/sales-narrative" : "/sales-narrative/edit"} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                      {narrativeDate ? "Update" : "Create"}
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {salesMotionDate ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className="text-sm text-gray-700">Sales Motion</span>
                      {salesMotionDate && <span className="text-xs text-gray-400">{formatDate(salesMotionDate)}</span>}
                    </div>
                    <a href={salesMotionDate ? "/sales-motion" : "/sales-motion/new"} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                      {salesMotionDate ? "Update" : "Create"}
                    </a>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  These assets provide context so Mikey can write strategically-aware follow-up emails with the right next steps for your motion. Works without them too.
                </p>
                </>
              )}
            </div>

            {/* Meeting Recorder Integration */}
            <MeetingRecorderPanel
              onSelectCall={(data) => {
                if (data.recordingUrl) setRecordingUrl(data.recordingUrl);
                if (data.summary) {
                  const headerLines: string[] = [];
                  if (data.date) {
                    headerLines.push(`Call Date: ${new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
                  }
                  if (data.attendees?.length) {
                    headerLines.push(`Attendees: ${data.attendees.map((a) => a.email ? `${a.name} (${a.email})` : a.name).join(", ")}`);
                  }
                  const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
                  setCallSummary(header + data.summary);
                }
                if (data.transcript) setCallTranscript(data.transcript);
                // Scroll to the content fields so the user can see what was populated
                setTimeout(() => callSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
              }}
            />

            <div className="space-y-5">
              {/* Recording URL — first field, required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Call Recording URL <span className="text-red-400">*</span>
                </label>
                <input
                  type="url"
                  value={recordingUrl}
                  onChange={(e) => setRecordingUrl(e.target.value)}
                  placeholder="https://fathom.video/share/... or Gong/Chorus link"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                />
                <div className="flex items-center gap-2 mt-1 min-h-[18px]">
                  {extracting ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-xs text-purple-600 font-medium">{extractionMessage}</p>
                    </>
                  ) : extractionMessage ? (
                    <p className="text-xs text-amber-600">{extractionMessage}</p>
                  ) : (
                    <p className="text-xs text-gray-400">Public share link — Mikey will try to auto-extract the transcript</p>
                  )}
                </div>
              </div>

              {/* Call Summary — required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Call Summary <span className="text-red-400">*</span>
                </label>
                <textarea
                  ref={callSummaryRef}
                  value={callSummary}
                  onChange={(e) => setCallSummary(e.target.value)}
                  placeholder="Paste the call summary from your call recorder..."
                  rows={6}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                />
              </div>

              {/* Transcript — optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Transcript <span className="text-gray-400 font-normal">(optional but recommended)</span>
                </label>
                <textarea
                  value={callTranscript}
                  onChange={(e) => setCallTranscript(e.target.value)}
                  placeholder="Paste the full call transcript for richer detail..."
                  rows={4}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                />
              </div>

              {/* Custom Notes — optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Custom Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder='e.g., "Emphasize the security review timeline" or "CC the CFO on the follow-up"'
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                />
              </div>

              {/* Tone & Polish — persistent, saves on blur */}
              {toneLoaded && (
                <div className="border-t border-gray-100 pt-5">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tone &amp; Polish <span className="text-gray-400 font-normal">(saved for all recaps)</span>
                  </label>
                  <textarea
                    value={toneGuidance}
                    onChange={(e) => setToneGuidance(e.target.value)}
                    onBlur={saveToneGuidance}
                    placeholder='e.g., "Keep it concise and direct — no fluff. Use a warm but professional tone. Always end with a specific next step and proposed date."'
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {toneSaving ? "Saving..." : "This guidance applies to all recap emails you generate. Edit anytime."}
                  </p>
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Recap Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
