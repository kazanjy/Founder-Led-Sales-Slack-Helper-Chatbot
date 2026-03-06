"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { DISCOVERY_CALL_RUBRIC } from "@/lib/call-review/rubric";
import { detectVendor, ALL_VENDORS } from "@/lib/call-review/vendors";

interface ScoreItem {
  score: number;
  evidence: string;
  overridden: boolean;
}

interface SectionScores {
  items: Record<string, ScoreItem>;
}

interface RedFlagResult {
  triggered: boolean;
  note: string;
}

interface TalkTimeParticipant {
  name: string;
  role: "rep" | "prospect" | "other";
  percentage: number;
}

interface AnalysisResult {
  sections: Record<string, SectionScores>;
  redFlags: Record<string, RedFlagResult>;
  summary: string;
  topStrength: string;
  topImprovement: string;
  talkTime?: {
    participants: TalkTimeParticipant[];
    repPercentage: number;
    prospectPercentage: number;
    assessment: string;
  };
}

interface CallReviewVersion {
  id: string;
  callType: string;
  title: string;
  transcript?: string;
  scores: AnalysisResult;
  overallScore: number;
  maxScore: number;
  conversationId?: string;
  createdAt: string;
}

export default function CallReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <CallReviewContent />
    </Suspense>
  );
}

function CallReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [version, setVersion] = useState<CallReviewVersion | null>(null);
  const [transcript, setTranscript] = useState("");
  const [includeDiscoveryQuestions, setIncludeDiscoveryQuestions] = useState(true);
  const [includeSalesNarrative, setIncludeSalesNarrative] = useState(true);
  const [inputMode, setInputMode] = useState<"link" | "paste">("link");
  const [shareUrl, setShareUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionFallback, setExtractionFallback] = useState<string | null>(null);
  const [detectedVendor, setDetectedVendor] = useState<ReturnType<typeof detectVendor>>(null);
  const [extractedFrom, setExtractedFrom] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"scorecard" | "transcript">("scorecard");
  const [recentReviews, setRecentReviews] = useState<Array<{
    id: string;
    title: string | null;
    overallScore: number | null;
    maxScore: number | null;
    createdAt: string;
  }>>([]);
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Call Review - Mikey";
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        if (versionId) {
          const res = await fetch(`/api/call-review/versions/${versionId}`);
          if (res.ok) {
            const data = await res.json();
            setVersion(data.version);
            setExpandedSections(new Set(DISCOVERY_CALL_RUBRIC.sections.map((s) => s.key)));
          }
        }
        // Fetch recent reviews for sidebar
        try {
          const versionsRes = await fetch("/api/call-review/versions");
          if (versionsRes.ok) {
            const versionsData = await versionsRes.json();
            setRecentReviews(versionsData.versions || []);
          }
        } catch {
          // Ignore - sidebar is non-critical
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, versionId]);

  const handleAnalyze = async () => {
    if (!transcript.trim() || transcript.trim().length < 100) {
      await showAlert({
        title: "Transcript Too Short",
        message: "Please paste a call transcript with at least 100 characters.",
        variant: "danger",
      });
      return;
    }

    setAnalyzing(true);
    try {
      const res = await fetch("/api/call-review/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcript.trim(),
          includeDiscoveryQuestions,
          includeSalesNarrative,
          sourceUrl: shareUrl || undefined,
          sourceVendor: extractedFrom || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to analyze transcript",
          variant: "danger",
        });
        return;
      }

      const data = await res.json();
      setVersion(data.version);
      setExpandedSections(new Set(DISCOVERY_CALL_RUBRIC.sections.map((s) => s.key)));
      setTranscript("");
      // Add to recent reviews list
      setRecentReviews((prev) => [
        { id: data.version.id, title: data.version.title, overallScore: data.version.overallScore, maxScore: data.version.maxScore, createdAt: data.version.createdAt },
        ...prev,
      ]);
      // Update URL with version ID for sharing/bookmarking
      window.history.replaceState({}, "", `/call-review?version=${data.version.id}`);
    } catch (error) {
      console.error("Error analyzing:", error);
      await showAlert({
        title: "Error",
        message: "Failed to analyze transcript. Please try again.",
        variant: "danger",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleScoreOverride = async (sectionKey: string, itemKey: string, newScore: number) => {
    if (!version) return;

    const updatedScores = JSON.parse(JSON.stringify(version.scores)) as AnalysisResult;
    updatedScores.sections[sectionKey].items[itemKey].score = newScore;
    updatedScores.sections[sectionKey].items[itemKey].overridden = true;

    // Recalculate overall score
    let overall = 0;
    for (const section of DISCOVERY_CALL_RUBRIC.sections) {
      const sectionScores = updatedScores.sections[section.key];
      if (sectionScores) {
        for (const item of section.items) {
          const itemScore = sectionScores.items[item.key];
          if (itemScore) {
            overall += itemScore.score;
          }
        }
      }
    }

    setVersion({ ...version, scores: updatedScores, overallScore: overall });

    // Save to backend
    try {
      await fetch(`/api/call-review/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: updatedScores, overallScore: overall }),
      });
    } catch (error) {
      console.error("Error saving score override:", error);
    }
  };

  const toggleSection = (key: string) => {
    const updated = new Set(expandedSections);
    if (updated.has(key)) {
      updated.delete(key);
    } else {
      updated.add(key);
    }
    setExpandedSections(updated);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getScoreColor = (score: number, max: number) => {
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.8) return "text-green-600";
    if (pct >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score: number) => {
    if (score === 2) return "bg-green-100 text-green-700 border-green-300";
    if (score === 1) return "bg-yellow-100 text-yellow-700 border-yellow-300";
    return "bg-red-100 text-red-700 border-red-300";
  };

  const getSectionScore = (sectionKey: string): number => {
    if (!version?.scores?.sections?.[sectionKey]) return 0;
    const items = version.scores.sections[sectionKey].items;
    return Object.values(items).reduce((sum, item) => sum + item.score, 0);
  };

  const sectionColors: Record<string, { bg: string; border: string; text: string }> = {
    preCallOpening: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
    discoveryExecution: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
    relevancePivot: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
    closeNextStep: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-600">Loading call review...</p>
          </div>
        </div>
      </div>
    );
  }

  // No previous review — show the transcript input form
  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className={`grid ${recentReviews.length > 0 ? "lg:grid-cols-3" : ""} gap-8`}>
            {/* Main input form */}
            <div className={recentReviews.length > 0 ? "lg:col-span-2" : ""}>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Discovery Call Review</h1>
                <p className="text-gray-500 mb-6">
                  Share a call recording link or paste a transcript to get an AI-powered scorecard with actionable feedback.
                </p>

                {/* Input mode tabs */}
                <div className="flex border-b border-gray-200 mb-5">
                  <button
                    onClick={() => setInputMode("link")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      inputMode === "link"
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Paste Link
                  </button>
                  <button
                    onClick={() => setInputMode("paste")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      inputMode === "paste"
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Paste Transcript
                  </button>
                </div>

                <div className="space-y-4">
                  {/* ── Paste Link tab ──────────────────────────────── */}
                  {inputMode === "link" && !transcript && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Share Link
                        </label>
                        <input
                          type="url"
                          value={shareUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setShareUrl(val);
                            setExtractionError(null);
                            setExtractionFallback(null);
                            const v = detectVendor(val);
                            setDetectedVendor(v);
                          }}
                          placeholder="Paste a share link from Sybill, Fathom, Fireflies, Otter, Circleback..."
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                          disabled={extracting}
                        />
                      </div>

                      {/* Vendor detection badge */}
                      {detectedVendor && detectedVendor.extractable && (
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span><strong>{detectedVendor.name}</strong> detected — ready to extract transcript</span>
                        </div>
                      )}

                      {/* Non-extractable vendor warning */}
                      {detectedVendor && !detectedVendor.extractable && (
                        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <p className="font-medium mb-1">{detectedVendor.name} — Manual paste required</p>
                          <p className="text-amber-700">{detectedVendor.manualPasteInstructions}</p>
                          <button
                            onClick={() => setInputMode("paste")}
                            className="mt-2 text-purple-600 hover:text-purple-700 font-medium underline text-xs"
                          >
                            Switch to Paste Transcript
                          </button>
                        </div>
                      )}

                      {/* Unrecognized URL */}
                      {shareUrl.trim().length > 10 && !detectedVendor && /^https?:\/\//.test(shareUrl.trim()) && (
                        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          We don&apos;t recognize this link yet. You can try extracting, or{" "}
                          <button
                            onClick={() => setInputMode("paste")}
                            className="text-purple-600 hover:text-purple-700 font-medium underline"
                          >
                            paste the transcript directly
                          </button>.
                        </div>
                      )}

                      {/* Extraction error */}
                      {extractionError && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          <p>{extractionError}</p>
                          {extractionFallback && (
                            <p className="mt-1 text-red-600">{extractionFallback}</p>
                          )}
                          <button
                            onClick={() => setInputMode("paste")}
                            className="mt-2 text-purple-600 hover:text-purple-700 font-medium underline text-xs"
                          >
                            Paste Manually Instead
                          </button>
                        </div>
                      )}

                      {/* Extract button */}
                      <button
                        onClick={async () => {
                          setExtracting(true);
                          setExtractionError(null);
                          setExtractionFallback(null);
                          try {
                            const res = await fetch("/api/call-review/extract", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ url: shareUrl.trim() }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setExtractionError(data.error || "Extraction failed.");
                              setExtractionFallback(data.manualInstructions || null);
                            } else {
                              setTranscript(data.transcript);
                              setExtractedFrom(data.vendor || null);
                            }
                          } catch {
                            setExtractionError("Network error. Please try again or paste the transcript manually.");
                          } finally {
                            setExtracting(false);
                          }
                        }}
                        disabled={extracting || !shareUrl.trim() || (detectedVendor !== null && !detectedVendor.extractable)}
                        className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {extracting ? (
                          <>
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Extracting transcript{detectedVendor ? ` from ${detectedVendor.name}` : ""}... (15-30 seconds)
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Extract Transcript
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* ── Extracted transcript review ───────────────── */}
                  {inputMode === "link" && transcript && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>
                            Transcript extracted{extractedFrom ? ` from ${extractedFrom}` : ""}{" "}
                            ({transcript.length.toLocaleString()} characters). Review and edit if needed.
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setTranscript("");
                            setExtractedFrom(null);
                            setShareUrl("");
                            setDetectedVendor(null);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 underline flex-shrink-0 ml-2"
                        >
                          Clear and start over
                        </button>
                      </div>
                      <textarea
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[300px] text-sm font-mono"
                        disabled={analyzing}
                      />
                      <p className="text-xs text-gray-400">
                        {transcript.length.toLocaleString()} characters
                      </p>
                    </div>
                  )}

                  {/* ── Paste Transcript tab ───────────────────────── */}
                  {inputMode === "paste" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Call Transcript
                      </label>
                      <textarea
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Paste your full call transcript here..."
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[300px] text-sm font-mono"
                        disabled={analyzing}
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        {transcript.length.toLocaleString()} characters
                      </p>

                      {/* Vendor copy-transcript guidance */}
                      <details className="mt-3">
                        <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 font-medium">
                          Where to find your transcript
                        </summary>
                        <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-1.5">
                          {ALL_VENDORS.filter((v) => v.extractable).map((v) => (
                            <div key={v.id}>
                              <strong>{v.name}:</strong> {v.manualPasteInstructions}
                            </div>
                          ))}
                          <hr className="border-gray-200 my-2" />
                          {ALL_VENDORS.filter((v) => !v.extractable).map((v) => (
                            <div key={v.id} className="text-amber-700">
                              <strong>{v.name}:</strong> {v.manualPasteInstructions}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {/* ── Shared controls (both tabs) ────────────────── */}
                  {(inputMode === "paste" || (inputMode === "link" && transcript)) && (
                    <>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={includeDiscoveryQuestions}
                            onChange={(e) => setIncludeDiscoveryQuestions(e.target.checked)}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          Include my Discovery Questions for comparison
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={includeSalesNarrative}
                            onChange={(e) => setIncludeSalesNarrative(e.target.checked)}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          Include my Sales Narrative for context
                        </label>
                      </div>

                      <button
                        onClick={handleAnalyze}
                        disabled={analyzing || transcript.trim().length < 100}
                        className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {analyzing ? (
                          <>
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Analyzing Call...
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            Analyze Call
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Reviews Sidebar */}
            {recentReviews.length > 0 && (
              <div>
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Recent Reviews</h2>
                    <Link
                      href="/call-review/history"
                      className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                    >
                      View All
                    </Link>
                  </div>
                  <div className="space-y-2">
                    {recentReviews.slice(0, 10).map((review) => (
                      <Link
                        key={review.id}
                        href={`/call-review?version=${review.id}`}
                        className="block w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {review.title || "Discovery Call"}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {review.overallScore != null && review.maxScore != null && (
                            <span className={`text-xs font-medium ${getScoreColor(review.overallScore, review.maxScore)}`}>
                              {review.overallScore}/{review.maxScore} ({Math.round((review.overallScore / review.maxScore) * 100)}%)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {formatDate(review.createdAt)}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  // Build shareable markdown content from the scorecard
  const buildShareContent = (): string => {
    let md = `# ${version.title || "Discovery Call Review"}\n\n`;
    md += `**Score: ${version.overallScore}/${version.maxScore}** (${Math.round((version.overallScore / version.maxScore) * 100)}%)\n\n`;
    md += `${version.scores.summary}\n\n`;
    md += `**Top Strength:** ${version.scores.topStrength}\n\n`;
    md += `**Top Improvement:** ${version.scores.topImprovement}\n\n`;

    // Talk time
    if (version.scores.talkTime) {
      md += `## Talk Time\n\n`;
      md += `**Rep:** ${version.scores.talkTime.repPercentage}% | **Prospect${version.scores.talkTime.participants.filter((p: { role: string }) => p.role === "prospect").length > 1 ? "s" : ""}:** ${version.scores.talkTime.prospectPercentage}%\n\n`;
      for (const p of version.scores.talkTime.participants) {
        md += `- ${p.name} (${p.role}): ${p.percentage}%\n`;
      }
      md += `\n_${version.scores.talkTime.assessment}_\n\n`;
    }

    // Red flags
    const flags = version.scores.redFlags
      ? Object.entries(version.scores.redFlags).filter(([, v]) => v.triggered)
      : [];
    if (flags.length > 0) {
      md += `## Red Flags\n\n`;
      for (const [key, flag] of flags) {
        const rubricFlag = DISCOVERY_CALL_RUBRIC.redFlags.find((f) => f.key === key);
        md += `- **${rubricFlag?.label || key}:** ${flag.note}\n`;
      }
      md += "\n";
    }

    // Sections
    for (const section of DISCOVERY_CALL_RUBRIC.sections) {
      const sectionScores = version.scores.sections?.[section.key];
      if (!sectionScores) continue;
      const sScore = Object.values(sectionScores.items).reduce((s, i) => s + i.score, 0);
      md += `## ${section.label} (${sScore}/${section.maxScore})\n\n`;
      for (const item of section.items) {
        const scored = sectionScores.items[item.key];
        if (!scored) continue;
        md += `- **${item.label}:** ${scored.score}/2 — ${scored.evidence}\n`;
      }
      md += "\n";
    }
    return md;
  };

  // Show scorecard
  const triggeredFlags = version.scores.redFlags
    ? Object.entries(version.scores.redFlags).filter(([, v]) => v.triggered)
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={analyzing}
        title="Analyzing Your Call"
        subtitle="Reviewing your conversation against the discovery call rubric"
        emojis={["📞", "🔍", "📊"]}
        messages={[
          "Reading your transcript",
          "Identifying key moments",
          "Scoring against the rubric",
          "Analyzing question technique",
          "Evaluating discovery depth",
          "Preparing your scorecard",
        ]}
      />
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/chat" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {version.title || "Discovery Call Review"}
                </h1>
                <p className="text-sm text-gray-500">
                  {formatDate(version.createdAt)} &middot; {version.overallScore}/{version.maxScore} ({Math.round((version.overallScore / version.maxScore) * 100)}%)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ChatAboutButton
                title="Chat About Call Review"
                getContext={() => {
                  let context = "";
                  if (version?.transcript) {
                    context += "## Transcript\n\n" + version.transcript + "\n\n";
                  }
                  if (version?.scores) {
                    context += "## Analysis\n\n";
                    context += "Summary: " + (version.scores.summary || "") + "\n";
                    context += "Top Strength: " + (version.scores.topStrength || "") + "\n";
                    context += "Top Improvement: " + (version.scores.topImprovement || "") + "\n";
                    context += `Score: ${version.overallScore}/${version.maxScore}\n\n`;
                    for (const section of DISCOVERY_CALL_RUBRIC.sections) {
                      const sectionScores = version.scores.sections?.[section.key];
                      if (!sectionScores) continue;
                      context += `### ${section.label}\n`;
                      for (const item of section.items) {
                        const scored = sectionScores.items[item.key];
                        if (scored) {
                          context += `- ${item.label}: ${scored.score}/2 — ${scored.evidence}\n`;
                        }
                      }
                      context += "\n";
                    }
                  }
                  context += "## Assessment Rubric\n\n";
                  for (const section of DISCOVERY_CALL_RUBRIC.sections) {
                    context += `### ${section.label}\n`;
                    for (const item of section.items) {
                      context += `- ${item.label}: 0=${item.scoringGuide["0"]}, 1=${item.scoringGuide["1"]}, 2=${item.scoringGuide["2"]}\n`;
                    }
                    context += "\n";
                  }
                  return context;
                }}
              />
              <Link
                href="/call-review/history"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                History
              </Link>
              <ShareDocumentButton
                documentType="callReview"
                documentId={version.id}
                title={version.title || "Discovery Call Review"}
                content={buildShareContent()}
              />
              {version.conversationId && (
                <Link
                  href={`/chat/${version.conversationId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </Link>
              )}
              <button
                onClick={() => {
                  setVersion(null);
                  setTranscript("");
                }}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Review
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("scorecard")}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "scorecard"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Scorecard
            </button>
            <button
              onClick={() => setActiveTab("transcript")}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "transcript"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Transcript
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Transcript Tab */}
        {activeTab === "transcript" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Call Transcript</h2>
            {version.transcript ? (
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed max-h-[70vh] overflow-y-auto">
                {version.transcript}
              </pre>
            ) : (
              <p className="text-gray-500 text-sm">Transcript not available for this review.</p>
            )}
          </div>
        )}

        {/* Scorecard Tab */}
        {activeTab === "scorecard" && <>
        {/* Overall Score Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Overall Score</h2>
              <p className="text-sm text-gray-500">{version.scores.summary}</p>
            </div>
            <div className="text-right">
              <div className={`text-4xl font-bold ${getScoreColor(version.overallScore, version.maxScore)}`}>
                {version.overallScore}/{version.maxScore}
              </div>
              <div className="text-sm text-gray-500">
                {Math.round((version.overallScore / version.maxScore) * 100)}%
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div
              className={`h-3 rounded-full transition-all ${
                version.overallScore / version.maxScore >= 0.8
                  ? "bg-green-500"
                  : version.overallScore / version.maxScore >= 0.6
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${(version.overallScore / version.maxScore) * 100}%` }}
            />
          </div>

          {/* Talk Time Analysis */}
          {version.scores.talkTime && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Talk Time
              </h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 flex h-6 rounded-full overflow-hidden">
                  <div
                    className={`${version.scores.talkTime.repPercentage <= 50 ? "bg-blue-500" : "bg-blue-400"} flex items-center justify-center text-xs font-medium text-white`}
                    style={{ width: `${version.scores.talkTime.repPercentage}%` }}
                  >
                    {version.scores.talkTime.repPercentage >= 15 && `${version.scores.talkTime.repPercentage}%`}
                  </div>
                  <div
                    className={`${version.scores.talkTime.prospectPercentage >= 40 ? "bg-green-500" : "bg-orange-400"} flex items-center justify-center text-xs font-medium text-white`}
                    style={{ width: `${version.scores.talkTime.prospectPercentage}%` }}
                  >
                    {version.scores.talkTime.prospectPercentage >= 15 && `${version.scores.talkTime.prospectPercentage}%`}
                  </div>
                </div>
              </div>
              <div className="flex gap-4 text-xs text-gray-600 mb-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  Rep ({version.scores.talkTime.repPercentage}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${version.scores.talkTime.prospectPercentage >= 40 ? "bg-green-500" : "bg-orange-400"} inline-block`} />
                  Prospect{version.scores.talkTime.participants.filter((p: { name: string; role: string; percentage: number }) => p.role === "prospect").length > 1 ? "s" : ""} ({version.scores.talkTime.prospectPercentage}%)
                </span>
              </div>
              {/* Individual participants */}
              <div className="space-y-1.5 mb-3">
                {version.scores.talkTime.participants.map((p: { name: string; role: string; percentage: number }, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-24 text-gray-600 truncate font-medium">{p.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      p.role === "rep" ? "bg-blue-100 text-blue-700" : p.role === "prospect" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {p.role}
                    </span>
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${p.role === "rep" ? "bg-blue-500" : p.role === "prospect" ? "bg-green-500" : "bg-gray-400"}`}
                        style={{ width: `${p.percentage}%` }}
                      />
                    </div>
                    <span className="text-gray-500 w-8 text-right">{p.percentage}%</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 italic">{version.scores.talkTime.assessment}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-50 rounded-lg p-3 border border-green-200">
              <p className="text-xs text-green-600 font-medium mb-1">Top Strength</p>
              <p className="text-sm text-green-800">{version.scores.topStrength}</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
              <p className="text-xs text-orange-600 font-medium mb-1">Top Improvement</p>
              <p className="text-sm text-orange-800">{version.scores.topImprovement}</p>
            </div>
          </div>
        </div>

        {/* Red Flags */}
        {triggeredFlags.length > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-6 mb-6">
            <h3 className="text-sm font-semibold text-red-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Red Flags
            </h3>
            <div className="space-y-2">
              {triggeredFlags.map(([key, flag]) => {
                const rubricFlag = DISCOVERY_CALL_RUBRIC.redFlags.find((f) => f.key === key);
                return (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">!</span>
                    <div>
                      <p className="text-sm font-medium text-red-800">{rubricFlag?.label || key}</p>
                      <p className="text-xs text-red-600">{flag.note}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section Scorecards */}
        <div className="space-y-4">
          {DISCOVERY_CALL_RUBRIC.sections.map((section) => {
            const colors = sectionColors[section.key] || { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700" };
            const isExpanded = expandedSections.has(section.key);
            const sectionScore = getSectionScore(section.key);

            return (
              <div key={section.key} className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
                <button
                  onClick={() => toggleSection(section.key)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${colors.text}`}>{section.label}</span>
                    <span className={`text-sm font-medium ${getScoreColor(sectionScore, section.maxScore)}`}>
                      {sectionScore}/{section.maxScore}
                    </span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-4 space-y-3">
                    {section.items.map((item) => {
                      const scored = version.scores.sections?.[section.key]?.items?.[item.key];
                      if (!scored) return null;

                      return (
                        <div key={item.key} className="bg-white rounded-lg p-4 border border-gray-100 shadow-sm">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <p className="text-sm text-gray-800 font-medium flex-1">{item.label}</p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {[0, 1, 2].map((s) => (
                                <button
                                  key={s}
                                  onClick={() => handleScoreOverride(section.key, item.key, s)}
                                  className={`w-7 h-7 rounded-md border text-xs font-bold transition-colors ${
                                    scored.score === s
                                      ? getScoreBgColor(s)
                                      : "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100"
                                  }`}
                                  title={item.scoringGuide[String(s) as "0" | "1" | "2"]}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 italic">
                            {scored.evidence}
                          </p>
                          {scored.overridden && (
                            <span className="inline-block mt-1 text-[10px] text-purple-600 font-medium bg-purple-50 px-1.5 py-0.5 rounded">
                              Manually adjusted
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Non-triggered red flags (for transparency) */}
        {version.scores.redFlags && (
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Red Flag Check
            </h3>
            <div className="space-y-2">
              {DISCOVERY_CALL_RUBRIC.redFlags.map((rf) => {
                const result = version.scores.redFlags[rf.key];
                return (
                  <div key={rf.key} className="flex items-center gap-2 text-sm">
                    {result?.triggered ? (
                      <span className="text-red-500 font-bold">!</span>
                    ) : (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className={result?.triggered ? "text-red-700" : "text-gray-600"}>
                      {rf.label}
                    </span>
                    {result?.note && (
                      <span className="text-xs text-gray-400 ml-1">
                        — {result.note}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>}
      </div>
      {ConfirmModalElement}
    </div>
  );
}
