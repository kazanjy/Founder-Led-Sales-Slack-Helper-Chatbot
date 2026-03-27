"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
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

const defaultColors = { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", gradient: "from-gray-500 to-gray-600" };

export default function HiringProfileEditPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading questions...</p>
        </div>
      </div>
    }>
      <HiringProfileEditContent />
    </Suspense>
  );
}

function HiringProfileEditContent() {
  const router = useRouter();

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
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  // Pre-fill state
  const [prefilling, setPrefilling] = useState(false);
  const [prefillMessageIndex, setPrefillMessageIndex] = useState(0);
  const [prefillDone, setPrefillDone] = useState(false);
  const [prefillPanelOpen, setPrefillPanelOpen] = useState(true);

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

        const response = await fetch("/api/hiring-profile/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        const initialAnswers: Record<string, string> = {};
        data.questions.forEach((q: Question) => {
          initialAnswers[q.id] = q.latestAnswer?.answer || "";
        });
        setAnswers(initialAnswers);
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
    setPrefilling(true);
    // Clear all existing answers so streamed ones fill in fresh
    const emptyAnswers: Record<string, string> = {};
    questions.forEach((q) => { emptyAnswers[q.id] = ""; });
    setAnswers(emptyAnswers);

    try {
      const response = await fetch("/api/hiring-profile/prefill-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
                setAnswers((prev) => ({ ...prev, [questionId]: answer }));
                savePromises.push(handleSaveAnswer(questionId, answer));
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

  const handleGenerate = async () => {
    await handleSaveAll();
    setHasUnsavedChanges(false);
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
          <p className="text-gray-600">Loading questions...</p>
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
        className={`bg-white border-b border-gray-200 transition-all duration-200 ${
          isHeaderSticky ? "fixed top-0 left-0 right-0 z-40 shadow-md" : ""
        }`}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/hiring-profile"
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  AE Hiring Profile Questionnaire
                </h1>
                <p className="text-sm text-gray-500">
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
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
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
                onClick={handleGenerate}
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
                <h3 className="font-semibold text-gray-900">
                  Smart Pre-Fill {prefillDone && <span className="text-green-600 text-sm font-normal ml-2">Done!</span>}
                </h3>
                <p className="text-sm text-gray-500">
                  Pre-fill from your Sales Narrative and GTM Assessment
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
            <div className="mt-2 bg-white border-2 border-amber-200 rounded-xl p-6">
              {prefilling ? (
                <div className="py-8 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-amber-100 to-orange-100 rounded-2xl flex items-center justify-center">
                    <svg className="animate-spin h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Pre-filling your Hiring Profile Q&amp;A
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    {PREFILL_MESSAGES[prefillMessageIndex]}...
                  </p>
                  <p className="text-xs text-gray-400">
                    This should take about 15-30 seconds
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    We&apos;ll use your existing Sales Narrative and GTM Assessment to automatically fill in answers.
                    You can review and edit everything after.
                  </p>
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
                <h2 className="text-2xl font-bold text-gray-900">{category.category}</h2>
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
                      className={`bg-white rounded-xl border-2 transition-colors ${
                        hasAnswer ? "border-green-200" : "border-gray-200"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row">
                        {/* Question Side */}
                        <div className="md:w-2/5 p-5 bg-gray-50 rounded-l-xl border-b md:border-b-0 md:border-r border-gray-200">
                          <div className="flex items-start gap-3">
                            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                              hasAnswer ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                            }`}>
                              {question.globalOrder}
                            </span>
                            <div>
                              <p className="text-gray-800 font-medium leading-relaxed">
                                {question.question}
                              </p>
                              {question.helpText && (
                                <p className="text-sm text-gray-500 mt-2 italic">
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
                            className="w-full min-h-[240px] p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
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
            className="px-8 py-4 bg-white text-purple-700 rounded-xl hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Hiring Profile
          </button>
        </div>
      </div>
      {ConfirmModalElement}
    </div>
  );
}
