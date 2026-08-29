"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseHiringRole } from "@/lib/hiring/role-types";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import { useConfirmModal } from "@/components/useConfirmModal";

interface Question {
  id: string;
  category: string;
  globalOrder: number;
  question: string;
  helpText: string | null;
  latestAnswer: { id: string; answer: string; createdAt: string } | null;
}

interface CategoryGroup {
  category: string;
  questions: Question[];
}

const PREFILL_MESSAGES = [
  "Analyzing your Sales Narrative",
  "Reviewing your GTM Assessment",
  "Scanning your GTM Readiness Progression",
  "Reviewing your Coaching Sessions",
  "Identifying sales motion patterns",
  "Mapping buyer profiles",
  "Drafting your answers",
  "Filling in your questionnaire",
];

// Category badge colors
const categoryColors: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  "Company Stage & Context": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", gradient: "from-purple-500 to-purple-600" },
  "Sales Motion": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", gradient: "from-blue-500 to-blue-600" },
  "Pipeline Generation": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", gradient: "from-orange-500 to-orange-600" },
  "Product & Narrative Complexity": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", gradient: "from-rose-500 to-rose-600" },
  "Buyer & Customer Profile": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", gradient: "from-cyan-500 to-cyan-600" },
  "Role Scope & Expectations": { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", gradient: "from-green-500 to-green-600" },
  "Founder Involvement": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", gradient: "from-amber-500 to-amber-600" },
  "Product Maturity": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", gradient: "from-teal-500 to-teal-600" },
};

const defaultColors = { bg: "bg-gray-50", text: "text-gray-700 dark:text-gray-200", border: "border-gray-200 dark:border-gray-700", gradient: "from-gray-500 to-gray-600" };

export default function HiringProfileEditPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-300">Loading questions...</p>
        </div>
      </div>
    }>
      <HiringProfileEditContent />
    </Suspense>
  );
}

function HiringProfileEditContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Which seat's questionnaire this is. Carried on the URL so the page
  // is linkable and a reload doesn't silently switch banks.
  const roleType = parseHiringRole(searchParams.get("role"));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  // Pre-fill state
  const [prefilling, setPrefilling] = useState(false);
  const [prefillMessageIndex, setPrefillMessageIndex] = useState(0);
  const [prefillDone, setPrefillDone] = useState(false);
  const [prefillPanelOpen, setPrefillPanelOpen] = useState(true);

  // Source freshness
  const [narrativeDate, setNarrativeDate] = useState<string | null>(null);
  const [assessmentDate, setAssessmentDate] = useState<string | null>(null);
  const [readinessDate, setReadinessDate] = useState<string | null>(null);
  const [coachingDate, setCoachingDate] = useState<string | null>(null);

  // Set browser tab title
  useEffect(() => {
    document.title = "AE Hiring Profile - Mikey";
  }, []);

  // Cycle through pre-fill loading messages
  useEffect(() => {
    if (!prefilling) {
      setPrefillMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setPrefillMessageIndex((prev) => (prev + 1) % PREFILL_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [prefilling]);

  // Handle sticky header
  useEffect(() => {
    const handleScroll = () => {
      if (headerRef.current) {
        setIsHeaderSticky(window.scrollY > 100);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Load questions on mount
  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        const response = await fetch(`/api/hiring-profile/questions?roleType=${roleType}`);
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        const initialAnswers: Record<string, string> = {};
        data.questions.forEach((q: Question) => {
          initialAnswers[q.id] = q.latestAnswer?.answer || "";
        });
        setAnswers(initialAnswers);

        // Fetch source freshness dates
        try {
          const [narRes, assessRes, readinessRes] = await Promise.all([
            fetch("/api/sales-narrative/latest"),
            fetch("/api/maturity/latest"),
            fetch("/api/sales-readiness"),
          ]);
          if (narRes.ok) {
            const narData = await narRes.json();
            if (narData.hasNarrative && narData.version?.createdAt) {
              setNarrativeDate(narData.version.createdAt);
            }
          }
          if (assessRes.ok) {
            const assessData = await assessRes.json();
            if (assessData.assessment?.completedAt) {
              setAssessmentDate(assessData.assessment.completedAt);
            }
          }
          if (readinessRes.ok) {
            const readinessData = await readinessRes.json();
            if (readinessData.overall && readinessData.overall.total > 0 && readinessData.overall.done > 0) {
              setReadinessDate(new Date().toISOString());
            }
          }
          // Coaching sessions
          try {
            const coachRes = await fetch("/api/coaching-sessions");
            if (coachRes.ok) {
              const coachData = await coachRes.json();
              if (coachData.sessions?.length > 0) {
                setCoachingDate(coachData.sessions[0].sessionDate);
              }
            }
          } catch { /* ignore */ }
        } catch { /* ignore */ }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // roleType is a dep: switching seats has to reload the question bank.
  }, [router, roleType]);

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
    setHasUnsavedChanges(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (value.trim()) {
      saveTimeoutRef.current = setTimeout(() => {
        handleSaveAnswer(questionId, value);
      }, 2000);
    }
  }, []);

  const handleSaveAnswer = async (questionId: string, value: string) => {
    if (!value.trim()) return;
    try {
      const response = await fetch(`/api/hiring-profile/answers/${questionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value.trim() }),
      });
      if (response.ok) {
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error("Error saving answer:", error);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const savePromises: Promise<Response>[] = [];
      Object.entries(answers).forEach(([questionId, value]) => {
        const answerToSave = value.trim();
        if (answerToSave) {
          savePromises.push(
            fetch(`/api/hiring-profile/answers/${questionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answer: answerToSave }),
            })
          );
        }
      });
      await Promise.all(savePromises);
      setHasUnsavedChanges(false);
      setLastSaved(new Date());
    } catch (error) {
      console.error("Error saving answers:", error);
    } finally {
      setSaving(false);
    }
  };

  const handlePrefill = async () => {
    // Check if there are existing answers
    const hasExisting = Object.values(answers).some((a) => a.trim());
    if (hasExisting) {
      const confirmed = await showConfirm({
        title: "Overwrite Existing Answers?",
        message: "Pre-filling will replace all current answers with new ones generated from your Sales Narrative, GTM Assessment, GTM Readiness, and Coaching Sessions. Continue?",
        variant: "warning",
        confirmLabel: "Overwrite & Pre-Fill",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
    }

    setPrefilling(true);
    // Clear all existing answers so streamed ones fill in fresh
    const emptyAnswers: Record<string, string> = {};
    questions.forEach((q) => { emptyAnswers[q.id] = ""; });
    setAnswers(emptyAnswers);

    try {
      const response = await fetch("/api/hiring-profile/prefill-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleType }),
      });

      if (!response.ok || !response.body) {
        let errorMsg = "Pre-fill failed";
        try {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } catch {
          errorMsg = `Server error (${response.status})`;
        }
        throw new Error(errorMsg);
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const savePromises: Promise<unknown>[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === "answer") {
                const { questionId, answer } = data;
                // Skip empty or quote-only answers
                const cleaned = (answer || "").replace(/^["'""'']+|["'""'']+$/g, "").trim();
                if (cleaned) {
                  setAnswers((prev) => ({ ...prev, [questionId]: cleaned }));
                  savePromises.push(handleSaveAnswer(questionId, cleaned));
                }
              } else if (currentEvent === "complete") {
                // All answers streamed
              } else if (currentEvent === "error") {
                throw new Error(data.message || "Prefill failed");
              }
            } catch (e) {
              if (e instanceof Error && e.message) throw e;
            }
            currentEvent = "";
          }
        }
      }

      await Promise.all(savePromises);
      setPrefillDone(true);
      setPrefillPanelOpen(false);
      setHasUnsavedChanges(false);
      setLastSaved(new Date());
    } catch (error) {
      console.error("Pre-fill error:", error);
      await showAlert({
        title: "Pre-Fill Error",
        message: error instanceof Error ? error.message : "Failed to pre-fill. Please try again.",
        variant: "danger",
      });
    } finally {
      setPrefilling(false);
    }
  };

  // Generation guidance state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateGuidance, setGenerateGuidance] = useState("");

  const handleGenerate = async () => {
    await handleSaveAll();
    setHasUnsavedChanges(false);
    if (generateGuidance.trim()) {
      try { sessionStorage.setItem("hiringProfileGuidance", generateGuidance.trim()); } catch { /* ignore */ }
    }
    router.push("/hiring-profile?generating=true");
  };

  // Calculate progress
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-300">Loading questions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />

      {/* Floating Header */}
      <div
        ref={headerRef}
        className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-all duration-200 ${
          isHeaderSticky ? "fixed top-0 left-0 right-0 z-40 shadow-md" : ""
        }`}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/hiring-profile"
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  AE Hiring Profile Questionnaire
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {answeredCount} of {totalQuestions} answered ({progressPercent}%)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastSaved && (
                <span className="text-xs text-gray-400">
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}

              <button
                onClick={handleSaveAll}
                disabled={saving}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                )}
                Save for Later
              </button>

              <button
                onClick={() => setShowGenerateModal(true)}
                disabled={saving || answeredCount === 0}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Profile
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Spacer for sticky header */}
      {isHeaderSticky && <div className="h-32" />}

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Smart Pre-Fill Panel */}
        <div className="mb-8">
          <button
            onClick={() => setPrefillPanelOpen((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl hover:border-amber-300 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  Smart Pre-Fill {prefillDone && <span className="text-green-600 text-sm font-normal ml-2">Done!</span>}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Pre-fill from your{" "}
                  <a href="/sales-narrative" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-amber-700 underline underline-offset-2 hover:text-amber-900 font-medium">Sales Narrative</a>
                  {", "}
                  <a href="/assessment/bulk" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-amber-700 underline underline-offset-2 hover:text-amber-900 font-medium">GTM Assessment</a>
                  {", "}
                  <a href="/sales-readiness" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-amber-700 underline underline-offset-2 hover:text-amber-900 font-medium">GTM Readiness</a>
                  {", and "}
                  <a href="/coaching-history" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-amber-700 underline underline-offset-2 hover:text-amber-900 font-medium">Coaching</a>
                </p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${prefillPanelOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {prefillPanelOpen && (
            <div className="mt-2 bg-white dark:bg-gray-800 border-2 border-amber-200 rounded-xl p-6">
              {prefilling ? (
                <div className="py-8 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-amber-100 to-orange-100 rounded-2xl flex items-center justify-center">
                    <svg className="animate-spin h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    Pre-filling your Hiring Profile Q&amp;A
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    {PREFILL_MESSAGES[prefillMessageIndex]}...
                  </p>
                  <p className="text-xs text-gray-400">
                    This should take about 15-30 seconds
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    We&apos;ll use your existing Sales Narrative, GTM Assessment, GTM Readiness, and Coaching Sessions to automatically fill in answers.
                    You can review and edit everything after.
                  </p>

                  {/* Source freshness */}
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {narrativeDate ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-200">Sales Narrative</span>
                        {narrativeDate && (
                          <span className="text-xs text-gray-400">
                            {new Date(narrativeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <a href={narrativeDate ? "/sales-narrative" : "/sales-narrative/edit"} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                        {narrativeDate ? "Update" : "Create"}
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {assessmentDate ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-200">GTM Assessment</span>
                        {assessmentDate && (
                          <span className="text-xs text-gray-400">
                            {new Date(assessmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <a href={assessmentDate ? "/assessment/bulk" : "/chat?startAssessment=true"} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                        {assessmentDate ? "Update" : "Start"}
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {readinessDate ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-200">GTM Readiness</span>
                      </div>
                      <a href="/sales-readiness" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                        {readinessDate ? "Update" : "Start"}
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {coachingDate ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-200">Coaching Sessions</span>
                        {coachingDate && (
                          <span className="text-xs text-gray-400">
                            {new Date(coachingDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <a href="/coaching-history" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                        {coachingDate ? "Update" : "Start"}
                      </a>
                    </div>
                    <p className="text-xs text-gray-400 pt-1">
                      For a more accurate profile, keep these up to date before pre-filling.
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={handlePrefill}
                      disabled={prefilling}
                      className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Pre-Fill
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Best-effort note */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm text-blue-800 font-medium">Answer as many or as few as you like</p>
            <p className="text-xs text-blue-600 mt-0.5">
              You don&apos;t need to answer every question. Mikey will generate the best possible AE hiring profile from whatever you provide &mdash; more detail just means a more tailored result.
            </p>
          </div>
        </div>

        {/* Questions grouped by category */}
        {grouped.map((category, categoryIndex) => {
          const colors = categoryColors[category.category] || defaultColors;
          return (
            <div key={category.category} className="mb-12">
              {/* Category Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-white font-bold text-lg shadow-md`}>
                  {categoryIndex + 1}
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{category.category}</h2>
                <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
                  {category.questions.filter((q) => answers[q.id]?.trim()).length} / {category.questions.length}
                </span>
              </div>

              {/* Questions */}
              <div className="space-y-6">
                {category.questions.map((question) => {
                  const hasAnswer = answers[question.id]?.trim();

                  return (
                    <div
                      key={question.id}
                      className={`bg-white dark:bg-gray-800 rounded-xl border-2 transition-colors ${
                        hasAnswer ? "border-green-200" : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row">
                        {/* Question Side */}
                        <div className="md:w-2/5 p-5 bg-gray-50 rounded-l-xl border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
                          <div className="flex items-start gap-3">
                            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                              hasAnswer ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600 dark:text-gray-300"
                            }`}>
                              {question.globalOrder}
                            </span>
                            <div>
                              <p className="text-gray-800 dark:text-gray-100 font-medium leading-relaxed">
                                {question.question}
                              </p>
                              {question.helpText && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 italic">
                                  {question.helpText}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Answer Side */}
                        <div className="md:w-3/5 p-5">
                          <textarea
                            value={answers[question.id] || ""}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            placeholder="Enter your answer..."
                            className="w-full min-h-[240px] p-3 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100"
                          />
                          {hasAnswer && (
                            <div className="mt-2 flex items-center gap-1 text-green-600 text-xs">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Answered
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Bottom Generate Section */}
        <div className="mt-12 mb-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
          <h3 className="text-2xl font-bold mb-2">Ready to Generate Your Hiring Profile?</h3>
          <p className="text-purple-100 mb-6">
            You&apos;ve answered {answeredCount} of {totalQuestions} questions.
            {answeredCount < totalQuestions && " Answer more for a better profile!"}
          </p>
          <button
            onClick={handleGenerate}
            disabled={saving || answeredCount === 0}
            className="px-8 py-4 bg-white dark:bg-gray-800 text-purple-700 rounded-xl hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Hiring Profile
          </button>
        </div>
      </div>
      {/* Generate Profile Modal — guidance + source freshness */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowGenerateModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Generate AE Hiring Profile</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Mikey will use your Q&amp;A answers plus these context sources to generate a tailored hiring profile.
            </p>

            {/* Source freshness */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {narrativeDate ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-200">Sales Narrative</span>
                  {narrativeDate && <span className="text-xs text-gray-400">{new Date(narrativeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                </div>
                <a href={narrativeDate ? "/sales-narrative" : "/sales-narrative/edit"} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 font-medium underline underline-offset-2">
                  {narrativeDate ? "Update" : "Create"}
                </a>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {assessmentDate ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-200">GTM Assessment</span>
                  {assessmentDate && <span className="text-xs text-gray-400">{new Date(assessmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                </div>
                <a href={assessmentDate ? "/assessment/bulk" : "/chat?startAssessment=true"} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 font-medium underline underline-offset-2">
                  {assessmentDate ? "Update" : "Start"}
                </a>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {readinessDate ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-200">GTM Readiness</span>
                </div>
                <a href="/sales-readiness" target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 font-medium underline underline-offset-2">
                  {readinessDate ? "Update" : "Start"}
                </a>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {coachingDate ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-200">Coaching Sessions</span>
                  {coachingDate && <span className="text-xs text-gray-400">{new Date(coachingDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                </div>
                <a href="/coaching-history" target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 font-medium underline underline-offset-2">
                  {coachingDate ? "Update" : "Start"}
                </a>
              </div>
            </div>

            {/* Optional guidance */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Guidance <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={generateGuidance}
                onChange={e => setGenerateGuidance(e.target.value)}
                placeholder='e.g., "Focus on outbound hunting skills" or "Target $50-100K ACV enterprise motion" — or leave blank to let Mikey decide'
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );
}
