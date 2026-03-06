"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface Question {
  id: string;
  category: string;
  globalOrder: number;
  question: string;
  latestAnswer: { answer: string; answeredAt: string } | null;
}

interface CategoryGroup {
  category: string;
  questions: Question[];
}

// Fun loading messages for the submission overlay
const LOADING_MESSAGES = [
  "Reticulating splines",
  "Confabulating insights",
  "Synthesizing brilliance",
  "Percolating recommendations",
  "Cogitating strategies",
  "Calibrating GTM engines",
  "Distilling wisdom",
  "Harmonizing data points",
  "Triangulating success vectors",
  "Crystallizing opportunities",
  "Marinating in your answers",
  "Consulting the sales oracles",
  "Aligning the revenue stars",
  "Brewing strategic potions",
  "Decoding founder magic",
];

// Wrapper component to handle Suspense for useSearchParams
export default function BulkAssessmentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading assessment...</p>
        </div>
      </div>
    }>
      <BulkAssessmentContent />
    </Suspense>
  );
}

function BulkAssessmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "update" ? "update" : "new";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [priorAnswers, setPriorAnswers] = useState<Record<string, { answer: string; answeredAt: string } | null>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set browser tab title based on mode
  useEffect(() => {
    document.title = mode === "update"
      ? "Update GTM Assessment - Mikey"
      : "GTM Maturity Assessment - Mikey";
  }, [mode]);

  // Cycle through loading messages when submitting
  useEffect(() => {
    if (!submitting) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [submitting]);

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
        // Check auth
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        // Load questions
        const response = await fetch("/api/maturity/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        // Store prior answers and initialize editable answers
        const initialAnswers: Record<string, string> = {};
        const priorAnswersMap: Record<string, { answer: string; answeredAt: string } | null> = {};

        data.questions.forEach((q: Question) => {
          priorAnswersMap[q.id] = q.latestAnswer;

          if (mode === "update") {
            // In update mode, start with empty textareas
            initialAnswers[q.id] = "";
          } else {
            // In new mode, pre-fill with existing answers (for continuing in-progress)
            initialAnswers[q.id] = q.latestAnswer?.answer || "";
          }
        });

        setPriorAnswers(priorAnswersMap);
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

    // Auto-save after 2 seconds of no typing (only if there's content)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (value.trim()) {
      saveTimeoutRef.current = setTimeout(() => {
        handleSaveAnswer(questionId, value);
      }, 2000);
    }
  }, []);

  const handleDuplicatePriorAnswer = useCallback((questionId: string) => {
    const prior = priorAnswers[questionId];
    if (prior) {
      setAnswers((prev) => ({ ...prev, [questionId]: prior.answer }));
      setHasUnsavedChanges(true);
    }
  }, [priorAnswers]);

  const handleSaveAnswer = async (questionId: string, value: string) => {
    if (!value.trim()) return;

    try {
      const response = await fetch(`/api/maturity/answers/${questionId}`, {
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
      // In update mode: save new answers, or use prior answers if empty
      // In new mode: save all answers that have content
      const savePromises: Promise<Response>[] = [];

      Object.entries(answers).forEach(([questionId, value]) => {
        const answerToSave = value.trim();

        if (answerToSave) {
          // Save the new answer
          savePromises.push(
            fetch(`/api/maturity/answers/${questionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answer: answerToSave }),
            })
          );
        } else if (mode === "update" && priorAnswers[questionId]) {
          // In update mode with empty new answer, keep the prior answer (re-save it)
          savePromises.push(
            fetch(`/api/maturity/answers/${questionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answer: priorAnswers[questionId]!.answer }),
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

  const handleSubmit = async () => {
    // Save all answers first
    await handleSaveAll();

    setSubmitting(true);
    try {
      const response = await fetch("/api/maturity/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) throw new Error("Failed to submit assessment");

      const data = await response.json();
      setHasUnsavedChanges(false);
      router.push(`/chat/${data.conversation.id}`);
    } catch (error) {
      console.error("Error submitting assessment:", error);
      setSubmitting(false);
    }
  };

  // Calculate progress
  // In update mode, count both new answers AND prior answers (that will be kept)
  const getEffectiveAnswerCount = () => {
    let count = 0;
    questions.forEach((q) => {
      const newAnswer = answers[q.id]?.trim();
      const hasPrior = priorAnswers[q.id] !== null;

      if (newAnswer) {
        count++;
      } else if (mode === "update" && hasPrior) {
        // In update mode, prior answers count as answered (will be kept)
        count++;
      }
    });
    return count;
  };

  const answeredCount = mode === "update"
    ? getEffectiveAnswerCount()
    : Object.values(answers).filter((a) => a.trim()).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading assessment...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      {/* Submission Loading Overlay */}
      {submitting && (
        <div className="fixed inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-indigo-700 z-50 flex flex-col items-center justify-center text-white">
          <div className="flex gap-3 text-5xl mb-8">
            {["🌊", "🌊", "🌊"].map((emoji, i) => (
              <span
                key={i}
                className="animate-bounce"
                style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1s" }}
              >
                {emoji}
              </span>
            ))}
          </div>

          <div className="relative w-20 h-20 mb-8">
            <div className="absolute inset-0 border-4 border-white/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-white rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-4 border-transparent border-t-white/60 rounded-full animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }}></div>
          </div>

          <h3 className="text-2xl font-bold mb-4 text-center px-6">
            Submitting Your Assessment
          </h3>

          <div className="h-8 flex items-center justify-center">
            <p className="text-lg text-white/90 animate-pulse">
              {LOADING_MESSAGES[loadingMessageIndex]}...
            </p>
          </div>

          <p className="text-sm text-white/60 mt-8">
            This may take a moment while we analyze your responses
          </p>
        </div>
      )}

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
                href="/chat"
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {mode === "update" ? "Update GTM Assessment" : "GTM Maturity Assessment"}
                </h1>
                <p className="text-sm text-gray-500">
                  {answeredCount} of {totalQuestions} answered ({progressPercent}%)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Last saved indicator */}
              {lastSaved && (
                <span className="text-xs text-gray-400">
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}

              {/* View History link - show in update mode (implies prior assessments exist) */}
              {mode === "update" && (
                <Link
                  href="/maturity-history"
                  className="px-3 py-2 text-sm text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </Link>
              )}

              {/* Save for Later button */}
              <button
                onClick={handleSaveAll}
                disabled={saving || submitting}
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

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={saving || submitting || answeredCount === 0}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Get My Recommendations
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
        {grouped.map((category, categoryIndex) => (
          <div key={category.category} className="mb-12">
            {/* Category Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-lg shadow-md">
                {categoryIndex + 1}
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{category.category}</h2>
              <span className="text-sm text-gray-500 ml-auto">
                {category.questions.filter((q) => answers[q.id]?.trim()).length} / {category.questions.length} answered
              </span>
            </div>

            {/* Questions */}
            <div className="space-y-6">
              {category.questions.map((question) => {
                const newAnswer = answers[question.id]?.trim();
                const priorAnswer = priorAnswers[question.id];
                const hasPriorAnswer = priorAnswer !== null;

                // Determine if effectively answered (for styling)
                const isEffectivelyAnswered = mode === "update"
                  ? (newAnswer || hasPriorAnswer)
                  : newAnswer;

                return (
                  <div
                    key={question.id}
                    className={`bg-white rounded-xl border-2 transition-colors ${
                      isEffectivelyAnswered ? "border-green-200" : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-col md:flex-row">
                      {/* Question Side */}
                      <div className="md:w-2/5 p-5 bg-gray-50 rounded-l-xl border-b md:border-b-0 md:border-r border-gray-200">
                        <div className="flex items-start gap-3">
                          <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                            isEffectivelyAnswered ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                          }`}>
                            {question.globalOrder}
                          </span>
                          <p className="text-gray-800 font-medium leading-relaxed">
                            {question.question}
                          </p>
                        </div>
                      </div>

                      {/* Answer Side */}
                      <div className="md:w-3/5 p-5">
                        {/* Show prior answer in update mode */}
                        {mode === "update" && hasPriorAnswer && (
                          <div className="mb-4">
                            <div className="text-sm font-medium text-gray-700 mb-2">Your Previous Answer</div>
                            <div className="p-3 bg-gray-100 rounded-lg border border-gray-200 text-gray-700 text-sm whitespace-pre-wrap">
                              {priorAnswer.answer}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Answered {formatDate(priorAnswer.answeredAt)}
                            </div>
                          </div>
                        )}

                        {/* Updated Answer section for update mode */}
                        {mode === "update" && hasPriorAnswer ? (
                          <>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700">
                                Updated Answer <span className="font-normal text-gray-400">(leave empty to keep previous)</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDuplicatePriorAnswer(question.id)}
                                className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                Duplicate prior answer
                              </button>
                            </div>
                            <textarea
                              value={answers[question.id] || ""}
                              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                              placeholder="Enter your updated answer, or leave blank to keep the previous one..."
                              className="w-full min-h-[100px] p-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y text-gray-800"
                            />
                          </>
                        ) : (
                          <>
                            <textarea
                              value={answers[question.id] || ""}
                              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                              placeholder="Enter your answer... (or type 'N/A' if not applicable)"
                              className="w-full min-h-[100px] p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
                            />
                            {newAnswer && (
                              <div className="mt-2 flex items-center gap-1 text-green-600 text-xs">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Answered
                              </div>
                            )}
                          </>
                        )}

                        {/* Status indicator for update mode */}
                        {mode === "update" && hasPriorAnswer && (
                          <div className="mt-2 flex items-center gap-1 text-xs">
                            {newAnswer ? (
                              <span className="text-blue-600 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Will be updated
                              </span>
                            ) : (
                              <span className="text-green-600 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Keeping previous answer
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Bottom Submit Section */}
        <div className="mt-12 mb-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
          <h3 className="text-2xl font-bold mb-2">Ready to Get Your Recommendations?</h3>
          <p className="text-purple-100 mb-6">
            You&apos;ve answered {answeredCount} of {totalQuestions} questions.
            {answeredCount < totalQuestions && " Answer more for better recommendations!"}
          </p>
          <button
            onClick={handleSubmit}
            disabled={saving || submitting || answeredCount === 0}
            className="px-8 py-4 bg-white text-purple-700 rounded-xl hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Get My GTM Recommendations
          </button>
        </div>
      </div>
    </div>
  );
}
