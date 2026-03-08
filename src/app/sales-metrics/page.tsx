"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface Question {
  id: string;
  category: string;
  globalOrder: number;
  question: string;
  helpText: string | null;
  latestAnswer: { answer: string; source: string; answeredAt: string } | null;
}

interface CategoryGroup {
  category: string;
  questions: Question[];
}

interface PrefillAnswer {
  value: string | null;
  explanation: string;
}

interface AnalysisResult {
  top3Strengths: Array<{ title: string; detail: string }>;
  top3Improvements: Array<{ title: string; detail: string }>;
  workOnNext: { title: string; detail: string; actionSteps: string[] };
  metricsTable: Record<string, { value: string; benchmark: string; rating: string }>;
  generalAnalysis: string;
  csvDeepDive?: {
    winRateBySource?: string;
    trends?: string;
    repPerformance?: string;
    pipelineHealth?: string;
    otherInsights?: string;
  };
}

const LOADING_MESSAGES = [
  "Crunching your numbers",
  "Benchmarking your metrics",
  "Identifying trends",
  "Finding your strengths",
  "Spotting opportunities",
  "Calculating conversion funnels",
  "Analyzing deal velocity",
  "Comparing to benchmarks",
  "Synthesizing insights",
  "Building recommendations",
];

export default function SalesMetricsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SalesMetricsContent />
    </Suspense>
  );
}

function SalesMetricsContent() {
  const router = useRouter();

  // State
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerSources, setAnswerSources] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // CSV upload state
  const [uploading, setUploading] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string | null>(null);
  const [csvInsights, setCsvInsights] = useState<Record<string, unknown> | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [prefilledCount, setPrefilledCount] = useState(0);
  const [csvRowCount, setCsvRowCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submit / analysis state
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisReport, setAnalysisReport] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);

  // Drag state
  const [dragOver, setDragOver] = useState(false);

  // Set page title
  useEffect(() => {
    document.title = "Sales Metrics Analyzer - Mikey";
  }, []);

  // Cycle loading messages
  useEffect(() => {
    if (!submitting && !uploading) {
      setLoadingMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [submitting, uploading]);

  // Load questions
  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        const response = await fetch("/api/sales-metrics/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        const initialAnswers: Record<string, string> = {};
        const sources: Record<string, string> = {};
        data.questions.forEach((q: Question) => {
          initialAnswers[q.id] = q.latestAnswer?.answer || "";
          if (q.latestAnswer?.source) {
            sources[q.id] = q.latestAnswer.source;
          }
        });
        setAnswers(initialAnswers);
        setAnswerSources(sources);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleAnswerChange = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setAnswerSources((prev) => ({ ...prev, [questionId]: "manual" }));
    setHasUnsavedChanges(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (value.trim()) {
      saveTimeoutRef.current = setTimeout(() => {
        handleSaveAnswer(questionId, value, "manual");
      }, 2000);
    }
  }, []);

  const handleSaveAnswer = async (questionId: string, value: string, source: string = "manual") => {
    if (!value.trim()) return;
    try {
      const response = await fetch(`/api/sales-metrics/answers/${questionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value.trim(), source }),
      });
      if (response.ok) {
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error("Error saving answer:", error);
    }
  };

  // CSV Upload
  const handleFileUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvError("Please upload a CSV file (.csv)");
      return;
    }

    setUploading(true);
    setCsvError(null);
    setCsvFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/sales-metrics/parse-csv", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to parse CSV");
      }

      const data = await response.json();

      // Store CSV data for later submission
      setCsvData(data.csvData);
      setCsvInsights(data.additionalInsights);
      setPrefilledCount(data.prefilledCount);
      setCsvRowCount(data.rowCount);

      // Re-load questions to pick up the new pre-filled answers
      const questionsRes = await fetch("/api/sales-metrics/questions");
      if (questionsRes.ok) {
        const qData = await questionsRes.json();
        setQuestions(qData.questions);
        setGrouped(qData.grouped);

        const updatedAnswers: Record<string, string> = {};
        const updatedSources: Record<string, string> = {};
        qData.questions.forEach((q: Question) => {
          updatedAnswers[q.id] = q.latestAnswer?.answer || "";
          if (q.latestAnswer?.source) {
            updatedSources[q.id] = q.latestAnswer.source;
          }
        });
        setAnswers(updatedAnswers);
        setAnswerSources(updatedSources);
      }

    } catch (error) {
      console.error("CSV upload error:", error);
      setCsvError(error instanceof Error ? error.message : "Failed to process CSV file");
      setCsvFileName(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  // Submit for analysis
  const handleSubmit = async () => {
    // Save any unsaved answers first
    const savePromises = Object.entries(answers)
      .filter(([, value]) => value.trim())
      .map(([questionId, value]) =>
        fetch(`/api/sales-metrics/answers/${questionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: value.trim(), source: answerSources[questionId] || "manual" }),
        })
      );

    await Promise.all(savePromises);

    setSubmitting(true);

    try {
      const response = await fetch("/api/sales-metrics/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvData,
          csvFileName,
          csvInsights,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to analyze metrics");
      }

      const data = await response.json();
      setAnalysisResult(data.analysis);
      setAnalysisReport(data.analysisReport);
      setConversationId(data.conversation?.id);
      setAssessmentId(data.assessment?.id);
      setHasUnsavedChanges(false);

      // Scroll to results
      setTimeout(() => {
        document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (error) {
      console.error("Submit error:", error);
      alert(error instanceof Error ? error.message : "Failed to analyze metrics. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChatAbout = async () => {
    if (conversationId) {
      router.push(`/chat/${conversationId}`);
    } else if (assessmentId) {
      try {
        const response = await fetch("/api/sales-metrics/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assessmentId }),
        });
        if (response.ok) {
          const data = await response.json();
          router.push(`/chat/${data.conversationId}`);
        }
      } catch (error) {
        console.error("Error starting chat:", error);
      }
    }
  };

  const handleReset = () => {
    setAnalysisResult(null);
    setAnalysisReport(null);
    setConversationId(null);
    setAssessmentId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;
  const totalQuestions = questions.length;

  if (loading) {
    return (
      <>
        <SalesNavBar />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading sales metrics...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SalesNavBar />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-bold text-gray-900">Sales Metrics Analyzer</h1>
              <Link
                href="/sales-metrics/history"
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                View History
              </Link>
            </div>
            <p className="text-gray-600">
              Upload your CRM data or fill in your metrics manually to get a comprehensive analysis of your sales performance.
            </p>
          </div>

          {/* CSV Upload Zone */}
          {!analysisResult && (
            <div className="mb-8">
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  dragOver
                    ? "border-purple-500 bg-purple-50"
                    : csvFileName
                    ? "border-green-300 bg-green-50"
                    : "border-gray-300 bg-white hover:border-purple-400 hover:bg-purple-50/30"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={() => setDragOver(false)}
              >
                {uploading ? (
                  <div>
                    <svg className="animate-spin h-10 w-10 text-purple-600 mx-auto mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-purple-700 font-medium mb-1">Analyzing your opportunity data...</p>
                    <p className="text-sm text-purple-500">{LOADING_MESSAGES[loadingMessageIndex]}...</p>
                  </div>
                ) : csvFileName ? (
                  <div>
                    <div className="text-green-600 text-3xl mb-2">✓</div>
                    <p className="text-green-700 font-medium mb-1">{csvFileName} uploaded successfully</p>
                    <p className="text-sm text-green-600">
                      {csvRowCount} opportunities analyzed · {prefilledCount} of {totalQuestions} metrics auto-filled
                    </p>
                    <button
                      onClick={() => {
                        setCsvFileName(null);
                        setCsvData(null);
                        setCsvInsights(null);
                        setPrefilledCount(0);
                      }}
                      className="mt-2 text-sm text-gray-500 hover:text-gray-700 underline"
                    >
                      Remove and start fresh
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="text-gray-400 text-3xl mb-3">📊</div>
                    <p className="text-gray-700 font-medium mb-1">
                      Drag & drop your CRM export CSV here, or{" "}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-purple-600 hover:text-purple-700 underline"
                      >
                        click to browse
                      </button>
                    </p>
                    <p className="text-sm text-gray-500 mb-4">
                      We&apos;ll analyze your opportunities and auto-fill your metrics
                    </p>

                    {/* Recommended fields */}
                    <div className="text-left max-w-xl mx-auto bg-gray-50 rounded-lg p-4 text-sm">
                      <p className="font-medium text-gray-700 mb-2">
                        Recommended CSV fields (the more the better):
                      </p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-gray-600">
                        <div>
                          <p className="font-medium text-gray-700 mt-1 mb-0.5">Deal</p>
                          <p>opportunity_id</p>
                          <p>account_id</p>
                          <p>owner_id</p>
                          <p>opportunity_type</p>
                          <p>amount</p>
                          <p>stage</p>
                          <p>created_at</p>
                          <p>close_date</p>
                          <p>actual_close_date</p>
                          <p>lead_source</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-700 mt-1 mb-0.5">Funnel</p>
                          <p>first_meeting_date</p>
                          <p>demo_date</p>
                          <p>proposal_sent_date</p>
                          <p className="font-medium text-gray-700 mt-2 mb-0.5">Context</p>
                          <p>company_size</p>
                          <p>industry</p>
                          <p>buyer_role</p>
                          <p>trigger_event</p>
                          <p>current_solution</p>
                          <p>competitor</p>
                        </div>
                      </div>
                      <div className="mt-1 text-gray-600">
                        <p className="font-medium text-gray-700 mt-2 mb-0.5">Outcome</p>
                        <p>is_won · closed_lost_reason · closed_lost_notes</p>
                      </div>
                      <p className="mt-3 text-gray-500 italic">
                        Works with any CRM export (Salesforce, HubSpot, Pipedrive, Close, etc.).
                        To analyze a specific time period, just limit the rows in your CSV.
                      </p>
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>

              {csvError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {csvError}
                </div>
              )}
            </div>
          )}

          {/* Questionnaire */}
          {!analysisResult && (
            <div className="space-y-8 mb-8">
              {grouped.map((group) => {
                const filledInGroup = group.questions.filter((q) => answers[q.id]?.trim()).length;
                return (
                  <div key={group.category} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-900">{group.category}</h2>
                        <span className={`text-sm font-medium ${filledInGroup === group.questions.length ? "text-green-600" : "text-gray-500"}`}>
                          {filledInGroup}/{group.questions.length}
                        </span>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {group.questions.map((q) => (
                        <div key={q.id} className="px-6 py-4">
                          <div className="flex items-start gap-2 mb-2">
                            <label className="block text-sm font-medium text-gray-800 flex-1">
                              {q.question}
                            </label>
                            {answerSources[q.id] === "csv" && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                CSV
                              </span>
                            )}
                          </div>
                          {q.helpText && (
                            <p className="text-xs text-gray-500 mb-2">{q.helpText}</p>
                          )}
                          <input
                            type="text"
                            value={answers[q.id] || ""}
                            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                            onBlur={() => {
                              if (answers[q.id]?.trim()) {
                                handleSaveAnswer(q.id, answers[q.id], answerSources[q.id] || "manual");
                              }
                            }}
                            placeholder="Enter value or leave blank"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Submit Bar */}
          {!analysisResult && (
            <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-6 px-6 py-4 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {answeredCount} of {totalQuestions} fields filled
                {lastSaved && (
                  <span className="ml-3 text-green-600">
                    Saved {lastSaved.toLocaleTimeString()}
                  </span>
                )}
              </div>
              <button
                onClick={handleSubmit}
                disabled={answeredCount === 0 || submitting}
                className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                  answeredCount > 0 && !submitting
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}
              >
                {submitting ? "Analyzing..." : "Analyze My Metrics"}
              </button>
            </div>
          )}

          {/* Submitting Overlay */}
          {submitting && (
            <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="text-center">
                <svg className="animate-spin h-12 w-12 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-lg font-medium text-gray-900 mb-1">{LOADING_MESSAGES[loadingMessageIndex]}...</p>
                <p className="text-sm text-gray-500">This may take a minute</p>
              </div>
            </div>
          )}

          {/* Results Section */}
          {analysisResult && (
            <div id="results-section" className="space-y-6">
              {/* Summary Metrics Cards */}
              {analysisResult.metricsTable && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(analysisResult.metricsTable)
                    .slice(0, 4)
                    .map(([key, metric]) => {
                      const q = questions.find((q) => String(q.globalOrder) === key);
                      return (
                        <div key={key} className="bg-white rounded-xl border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1 truncate">{q?.question?.replace(/\?$/, "") || `Metric ${key}`}</p>
                          <p className="text-xl font-bold text-gray-900">{metric.value || "N/A"}</p>
                          <p className="text-xs text-gray-400 mt-1">Benchmark: {metric.benchmark}</p>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Top 3 Strengths */}
              {analysisResult.top3Strengths?.length > 0 && (
                <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
                  <div className="bg-green-50 px-6 py-3 border-b border-green-200">
                    <h2 className="text-lg font-semibold text-green-800">Top 3 Strengths</h2>
                  </div>
                  <div className="divide-y divide-green-100">
                    {analysisResult.top3Strengths.map((s, i) => (
                      <div key={i} className="px-6 py-4">
                        <h3 className="font-medium text-green-700 mb-1">✅ {s.title}</h3>
                        <p className="text-sm text-gray-600">{s.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top 3 Improvements */}
              {analysisResult.top3Improvements?.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-50 px-6 py-3 border-b border-amber-200">
                    <h2 className="text-lg font-semibold text-amber-800">Top 3 Areas for Improvement</h2>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {analysisResult.top3Improvements.map((s, i) => (
                      <div key={i} className="px-6 py-4">
                        <h3 className="font-medium text-amber-700 mb-1">⚠️ {s.title}</h3>
                        <p className="text-sm text-gray-600">{s.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* #1 Priority */}
              {analysisResult.workOnNext && (
                <div className="bg-purple-50 rounded-xl border-2 border-purple-300 p-6">
                  <h2 className="text-lg font-bold text-purple-900 mb-2">
                    🎯 #1 Priority: {analysisResult.workOnNext.title}
                  </h2>
                  <p className="text-sm text-gray-700 mb-3">{analysisResult.workOnNext.detail}</p>
                  {analysisResult.workOnNext.actionSteps?.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-purple-800 mb-1">Action Steps:</p>
                      <ul className="text-sm text-gray-700 space-y-1">
                        {analysisResult.workOnNext.actionSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-purple-500 mt-0.5">•</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* All Metrics Table */}
              {analysisResult.metricsTable && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">All Metrics</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-6 py-2 text-gray-600 font-medium">Metric</th>
                          <th className="text-left px-4 py-2 text-gray-600 font-medium">Your Value</th>
                          <th className="text-left px-4 py-2 text-gray-600 font-medium">Benchmark</th>
                          <th className="text-left px-4 py-2 text-gray-600 font-medium">Rating</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {Object.entries(analysisResult.metricsTable).map(([key, metric]) => {
                          const q = questions.find((q) => String(q.globalOrder) === key);
                          const ratingColors = {
                            good: "bg-green-100 text-green-700",
                            ok: "bg-yellow-100 text-yellow-700",
                            needs_work: "bg-red-100 text-red-700",
                          };
                          const ratingColor = ratingColors[metric.rating as keyof typeof ratingColors] || "bg-gray-100 text-gray-700";
                          return (
                            <tr key={key}>
                              <td className="px-6 py-3 text-gray-800">{q?.question || `Metric ${key}`}</td>
                              <td className="px-4 py-3 font-medium text-gray-900">{metric.value || "N/A"}</td>
                              <td className="px-4 py-3 text-gray-500">{metric.benchmark}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ratingColor}`}>
                                  {metric.rating === "needs_work" ? "Needs Work" : metric.rating === "good" ? "Good" : "OK"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* General Analysis */}
              {analysisResult.generalAnalysis && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">General Analysis</h2>
                  <div
                    className="prose prose-sm max-w-none text-gray-700"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.generalAnalysis) }}
                  />
                </div>
              )}

              {/* CSV Deep Dive */}
              {analysisResult.csvDeepDive && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-blue-50 px-6 py-3 border-b border-blue-200">
                    <h2 className="text-lg font-semibold text-blue-900">CRM Data Deep Dive</h2>
                  </div>
                  <div className="p-6 space-y-6">
                    {analysisResult.csvDeepDive.winRateBySource && (
                      <div>
                        <h3 className="font-medium text-gray-800 mb-2">Win Rate by Lead Source</h3>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.csvDeepDive.winRateBySource) }}
                        />
                      </div>
                    )}
                    {analysisResult.csvDeepDive.trends && (
                      <div>
                        <h3 className="font-medium text-gray-800 mb-2">Trends Over Time</h3>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.csvDeepDive.trends) }}
                        />
                      </div>
                    )}
                    {analysisResult.csvDeepDive.repPerformance && (
                      <div>
                        <h3 className="font-medium text-gray-800 mb-2">Rep Performance</h3>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.csvDeepDive.repPerformance) }}
                        />
                      </div>
                    )}
                    {analysisResult.csvDeepDive.pipelineHealth && (
                      <div>
                        <h3 className="font-medium text-gray-800 mb-2">Pipeline Health</h3>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.csvDeepDive.pipelineHealth) }}
                        />
                      </div>
                    )}
                    {analysisResult.csvDeepDive.otherInsights && (
                      <div>
                        <h3 className="font-medium text-gray-800 mb-2">Other Insights</h3>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(analysisResult.csvDeepDive.otherInsights) }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-4 pt-4 pb-8">
                <button
                  onClick={handleChatAbout}
                  className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 transition-colors"
                >
                  💬 Chat About These Results
                </button>
                <button
                  onClick={handleReset}
                  className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
                >
                  Run New Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Simple markdown to HTML converter for analysis text
function markdownToHtml(md: string): string {
  return md
    .replace(/### (.*)/g, '<h3 class="text-base font-semibold text-gray-800 mt-4 mb-2">$1</h3>')
    .replace(/## (.*)/g, '<h2 class="text-lg font-semibold text-gray-800 mt-4 mb-2">$1</h2>')
    .replace(/# (.*)/g, '<h1 class="text-xl font-bold text-gray-900 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.*)/gm, '<li class="ml-4">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-4 space-y-1 my-2">$&</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => c.trim().match(/^-+$/))) return "";
      const tag = "td";
      const row = cells.map((c) => `<${tag} class="px-3 py-1 border border-gray-200">${c.trim()}</${tag}>`).join("");
      return `<tr>${row}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table class="w-full border-collapse border border-gray-200 my-2 text-sm">$&</table>')
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
