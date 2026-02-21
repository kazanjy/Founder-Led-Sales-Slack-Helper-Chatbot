"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

// Fun loading messages for the generation overlay
const LOADING_MESSAGES = [
  "Crafting your story",
  "Distilling your value prop",
  "Synthesizing your narrative",
  "Weaving your positioning",
  "Articulating your message",
  "Polishing your pitch",
  "Crystallizing your story",
  "Refining your narrative",
  "Sharpening your message",
  "Perfecting your positioning",
];

export default function SalesNarrativeEditPage() {
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
      <SalesNarrativeEditContent />
    </Suspense>
  );
}

function SalesNarrativeEditContent() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set browser tab title
  useEffect(() => {
    document.title = "Edit Sales Narrative - Mikey";
  }, []);

  // Cycle through loading messages when generating
  useEffect(() => {
    if (!generating) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [generating]);

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
        const response = await fetch("/api/sales-narrative/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        // Initialize answers from existing data
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

  const handleSaveAnswer = async (questionId: string, value: string) => {
    if (!value.trim()) return;

    try {
      const response = await fetch(`/api/sales-narrative/answers/${questionId}`, {
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
            fetch(`/api/sales-narrative/answers/${questionId}`, {
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

  const handleGenerate = async () => {
    // Save all answers first
    await handleSaveAll();

    setGenerating(true);
    try {
      const response = await fetch("/api/sales-narrative/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate narrative");
      }

      const data = await response.json();
      setHasUnsavedChanges(false);
      // Navigate to the main page which will show the new version
      router.push(`/sales-narrative?version=${data.version.id}`);
    } catch (error) {
      console.error("Error generating narrative:", error);
      alert(error instanceof Error ? error.message : "Failed to generate narrative. Please try again.");
      setGenerating(false);
    }
  };

  // Calculate progress
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Category colors
  const categoryColors: Record<string, { bg: string; text: string; gradient: string }> = {
    Product: { bg: "bg-indigo-500", text: "text-indigo-700", gradient: "from-indigo-500 to-violet-500" },
    Problem: { bg: "bg-red-500", text: "text-red-700", gradient: "from-red-500 to-orange-500" },
    Solution: { bg: "bg-blue-500", text: "text-blue-700", gradient: "from-blue-500 to-cyan-500" },
    Proof: { bg: "bg-green-500", text: "text-green-700", gradient: "from-green-500 to-emerald-500" },
    Business: { bg: "bg-purple-500", text: "text-purple-700", gradient: "from-purple-500 to-pink-500" },
  };

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
      {/* Generation Loading Overlay */}
      {generating && (
        <div className="fixed inset-0 bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-700 z-50 flex flex-col items-center justify-center text-white">
          <div className="flex gap-3 text-5xl mb-8">
            {["✍️", "📝", "✨"].map((emoji, i) => (
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
            Generating Your Sales Narrative
          </h3>

          <div className="h-8 flex items-center justify-center">
            <p className="text-lg text-white/90 animate-pulse">
              {LOADING_MESSAGES[loadingMessageIndex]}...
            </p>
          </div>

          <p className="text-sm text-white/60 mt-8">
            Creating your narrative, value propositions, and tagline
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
                  Sales Narrative Questionnaire
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

              {/* Save for Later button */}
              <button
                onClick={handleSaveAll}
                disabled={saving || generating}
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

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={saving || generating || answeredCount === 0}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Narrative
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
        {grouped.map((category, categoryIndex) => {
          const colors = categoryColors[category.category] || categoryColors.Problem;
          return (
            <div key={category.category} className="mb-12">
              {/* Category Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-white font-bold text-lg shadow-md`}>
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
                            className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
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
          <h3 className="text-2xl font-bold mb-2">Ready to Generate Your Narrative?</h3>
          <p className="text-purple-100 mb-6">
            You&apos;ve answered {answeredCount} of {totalQuestions} questions.
            {answeredCount < totalQuestions && " Answer more for a better narrative!"}
          </p>
          <button
            onClick={handleGenerate}
            disabled={saving || generating || answeredCount === 0}
            className="px-8 py-4 bg-white text-purple-700 rounded-xl hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Sales Narrative
          </button>
        </div>
      </div>
    </div>
  );
}
