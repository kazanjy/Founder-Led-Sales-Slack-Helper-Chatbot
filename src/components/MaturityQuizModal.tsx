"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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

interface MaturityQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (conversationId: string) => void;
  mode?: "continue" | "update"; // "update" starts at question 1, "continue" resumes where left off
}

export function MaturityQuizModal({ isOpen, onClose, onComplete, mode = "continue" }: MaturityQuizModalProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitScreen, setShowSubmitScreen] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveNextButtonRef = useRef<HTMLButtonElement>(null);

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

  // Focus textarea helper
  const focusTextarea = useCallback(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  // Load questions on mount
  useEffect(() => {
    if (!isOpen) return;

    async function loadQuestions() {
      try {
        setLoading(true);
        const response = await fetch("/api/maturity/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        // In "update" mode, check for existing progress or start new update session
        if (mode === "update") {
          // Check if there's an existing update in progress
          const progressResponse = await fetch("/api/maturity/update-progress");
          if (progressResponse.ok) {
            const progressData = await progressResponse.json();
            if (progressData.inProgress && progressData.currentIndex !== null) {
              // Resume from where they left off
              setCurrentIndex(progressData.currentIndex);
            } else {
              // Start a new update session
              await fetch("/api/maturity/update-progress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
              });
              setCurrentIndex(0);
            }
          } else {
            setCurrentIndex(0);
          }
          setShowSubmitScreen(false);
        } else {
          // In "continue" mode, find first unanswered question
          const firstUnanswered = data.questions.findIndex(
            (q: Question) => !q.latestAnswer
          );

          // If all questions are answered, show submit screen
          if (firstUnanswered === -1 && data.questions.length > 0) {
            setShowSubmitScreen(true);
            setCurrentIndex(data.questions.length - 1);
          } else {
            setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
            setShowSubmitScreen(false);
          }
        }
      } catch (error) {
        console.error("Error loading questions:", error);
      } finally {
        setLoading(false);
      }
    }

    loadQuestions();
  }, [isOpen, mode]);

  // Set current answer when question changes
  useEffect(() => {
    // In update mode, always start with empty textarea (user can duplicate prior answer)
    if (mode === "update") {
      setCurrentAnswer("");
    } else if (questions[currentIndex]?.latestAnswer) {
      setCurrentAnswer(questions[currentIndex].latestAnswer.answer);
    } else {
      setCurrentAnswer("");
    }
  }, [currentIndex, questions, mode]);

  // Save update progress whenever index changes in update mode
  useEffect(() => {
    if (mode !== "update" || loading || questions.length === 0) return;

    // Save the current index to the server (fire and forget)
    fetch("/api/maturity/update-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "progress", currentIndex }),
    }).catch((err) => console.error("Failed to save update progress:", err));
  }, [currentIndex, mode, loading, questions.length]);

  // Focus textarea when loading completes or question changes
  useEffect(() => {
    if (!loading && isOpen && !showSubmitScreen) {
      focusTextarea();
    }
  }, [currentIndex, loading, isOpen, focusTextarea, showSubmitScreen]);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = questions.filter((q) => q.latestAnswer).length;

  // In update mode, show progress through the review (currentIndex), not answered count
  const displayedProgress = mode === "update" ? currentIndex : answeredCount;
  const progressLabel = mode === "update" ? "reviewed" : "answered";
  const progressPercent = totalQuestions > 0 ? Math.round((displayedProgress / totalQuestions) * 100) : 0;

  // Get current category info
  const currentCategory = currentQuestion?.category;
  const categoryQuestions = questions.filter((q) => q.category === currentCategory);
  const categoryIndex = categoryQuestions.findIndex((q) => q.id === currentQuestion?.id);

  const handleSave = useCallback(async (advanceToNext: boolean = true) => {
    if (!currentQuestion || !currentAnswer.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/maturity/answers/${currentQuestion.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: currentAnswer.trim() }),
      });

      if (!response.ok) throw new Error("Failed to save answer");

      // Update local state
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentQuestion.id
            ? { ...q, latestAnswer: { answer: currentAnswer.trim(), answeredAt: new Date().toISOString() } }
            : q
        )
      );

      // Move to next question if requested
      if (advanceToNext) {
        if (currentIndex < totalQuestions - 1) {
          setCurrentIndex(currentIndex + 1);
          focusTextarea();
        } else {
          // Last question - show submit screen
          setShowSubmitScreen(true);
        }
      } else {
        focusTextarea();
      }
    } catch (error) {
      console.error("Error saving answer:", error);
    } finally {
      setSaving(false);
    }
  }, [currentQuestion, currentAnswer, currentIndex, totalQuestions, focusTextarea]);

  const handleNext = useCallback(async () => {
    // If there's content in the textarea, save it first
    if (currentAnswer.trim()) {
      await handleSave(true);
    } else if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Last question with no content - show submit screen anyway
      setShowSubmitScreen(true);
    }
  }, [currentAnswer, handleSave, currentIndex, totalQuestions]);

  const handleSkip = useCallback(() => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Skipping last question - show submit screen
      setShowSubmitScreen(true);
    }
  }, [currentIndex, totalQuestions]);

  // In update mode, keep existing answer and move to next
  const handleNoChange = useCallback(() => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setShowSubmitScreen(true);
    }
  }, [currentIndex, totalQuestions]);

  const handleBack = useCallback(() => {
    if (showSubmitScreen) {
      setShowSubmitScreen(false);
    } else if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, showSubmitScreen]);

  const handleSaveForLater = useCallback(async () => {
    // Save current answer if there is one
    if (currentAnswer.trim() && currentQuestion && !showSubmitScreen) {
      await handleSave(false);
    }
    onClose();
  }, [currentAnswer, currentQuestion, handleSave, onClose, showSubmitScreen]);

  const handleSubmit = useCallback(async () => {
    // If there's unsaved content, save it first
    if (currentAnswer.trim() && currentQuestion && !showSubmitScreen) {
      await handleSave(false);
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/maturity/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) throw new Error("Failed to submit assessment");

      const data = await response.json();
      onComplete(data.conversation.id);
    } catch (error) {
      console.error("Error submitting assessment:", error);
    } finally {
      setSubmitting(false);
    }
  }, [currentAnswer, currentQuestion, handleSave, onComplete, showSubmitScreen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  const handleGoToQuestion = useCallback((index: number) => {
    setCurrentIndex(index);
    setShowSubmitScreen(false);
  }, []);

  if (!isOpen) return null;

  // Calculate category summaries for submit screen
  const getCategorySummary = () => {
    const categories = [...new Set(questions.map(q => q.category))];
    return categories.map(cat => {
      const catQuestions = questions.filter(q => q.category === cat);
      const answered = catQuestions.filter(q => q.latestAnswer).length;
      return { category: cat, answered, total: catQuestions.length };
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Submission Loading Overlay */}
        {submitting && (
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-indigo-700 z-50 flex flex-col items-center justify-center text-white">
            {/* Bouncing waves */}
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

            {/* Spinning loader */}
            <div className="relative w-20 h-20 mb-8">
              <div className="absolute inset-0 border-4 border-white/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-transparent border-t-white rounded-full animate-spin"></div>
              <div className="absolute inset-2 border-4 border-transparent border-t-white/60 rounded-full animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }}></div>
            </div>

            {/* Title */}
            <h3 className="text-2xl font-bold mb-4 text-center px-6">
              Submitting Your Assessment
            </h3>

            {/* Rotating fun message */}
            <div className="h-8 flex items-center justify-center">
              <p className="text-lg text-white/90 animate-pulse">
                {LOADING_MESSAGES[loadingMessageIndex]}...
              </p>
            </div>

            {/* Progress hint */}
            <p className="text-sm text-white/60 mt-8">
              This may take a moment while we analyze your responses
            </p>
          </div>
        )}

        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              {mode === "update" ? "Updating GTM Assessment" : "GTM Maturity Assessment"}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{displayedProgress} of {totalQuestions} {progressLabel}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${mode === "update" ? "bg-purple-600" : "bg-blue-600"}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Category indicator - hide on submit screen */}
          {currentQuestion && !showSubmitScreen && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="font-medium text-blue-600">{currentCategory}</span>
              <span>•</span>
              <span>Question {categoryIndex + 1} of {categoryQuestions.length}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : showSubmitScreen ? (
            // Submit Screen
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                You&apos;re Ready to Submit!
              </h3>
              <p className="text-gray-600 mb-6">
                You&apos;ve answered {answeredCount} of {totalQuestions} questions.
                Submit now to get your personalized GTM recommendations.
              </p>

              {/* Category Summary */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
                <h4 className="font-semibold text-gray-900 mb-3">Summary by Category</h4>
                <div className="space-y-2">
                  {getCategorySummary().map(({ category, answered, total }) => (
                    <div key={category} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{category}</span>
                      <span className={answered === total ? "text-green-600 font-medium" : "text-gray-500"}>
                        {answered}/{total} answered
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Big Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={submitting || answeredCount === 0}
                className="w-full py-4 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-lg font-semibold flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
                autoFocus
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Getting Your Recommendations...
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Get My GTM Recommendations
                  </>
                )}
              </button>

              <button
                onClick={() => setShowSubmitScreen(false)}
                className="mt-4 text-gray-500 hover:text-gray-700 text-sm"
              >
                ← Go back and review answers
              </button>
            </div>
          ) : currentQuestion ? (
            <div>
              <div className="mb-2 text-sm text-gray-500">
                Question {currentIndex + 1} of {totalQuestions}
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {currentQuestion.question}
              </h3>

              {/* Update mode with existing answer */}
              {mode === "update" && currentQuestion.latestAnswer ? (
                <div className="space-y-4">
                  {/* Existing answer (read-only) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Your Previous Answer
                    </label>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-700 text-sm">
                      {currentQuestion.latestAnswer.answer}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      Answered {new Date(currentQuestion.latestAnswer.answeredAt).toLocaleDateString()}
                    </p>
                  </div>

                  {/* New answer input */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Updated Answer <span className="font-normal text-gray-500">(leave empty to keep previous)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setCurrentAnswer(currentQuestion.latestAnswer?.answer || "")}
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        tabIndex={-1}
                      >
                        Duplicate prior answer
                      </button>
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={currentAnswer}
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      placeholder="Enter your updated answer, or leave blank to keep the previous one..."
                      className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      tabIndex={1}
                    />
                  </div>
                </div>
              ) : (
                /* Normal mode or no existing answer */
                <>
                  <textarea
                    ref={textareaRef}
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    placeholder="Enter your answer..."
                    className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    tabIndex={1}
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    If you don&apos;t know the answer or the question doesn&apos;t apply to you, just say &quot;Don&apos;t know&quot; or &quot;NA&quot;.
                  </p>
                  {currentQuestion.latestAnswer && (
                    <div className="mt-2 text-xs text-gray-400">
                      Last answered: {new Date(currentQuestion.latestAnswer.answeredAt).toLocaleDateString()}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No questions available.
            </div>
          )}
        </div>

        {/* Navigation Footer - hide on submit screen */}
        {!showSubmitScreen && !loading && (
          <div className="px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={currentIndex === 0 || saving}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                tabIndex={4}
              >
                Back
              </button>

              <div className="flex items-center gap-2">
                {/* In update mode with existing answer, show "No Change" instead of "Skip" */}
                {mode === "update" && currentQuestion?.latestAnswer ? (
                  <button
                    onClick={handleNoChange}
                    disabled={saving}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    tabIndex={3}
                  >
                    No Change
                  </button>
                ) : (
                  <button
                    onClick={handleSkip}
                    disabled={saving}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    tabIndex={3}
                  >
                    Skip
                  </button>
                )}
                <button
                  ref={saveNextButtonRef}
                  onClick={handleNext}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                  tabIndex={2}
                >
                  {saving && (
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {mode === "update" && currentQuestion?.latestAnswer
                    ? (currentAnswer.trim() ? "Save Update" : "Next")
                    : (currentAnswer.trim() ? "Save & Next" : "Next")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Footer - hide on submit screen */}
        {!showSubmitScreen && !loading && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
            <div className="flex items-center justify-between">
              <button
                onClick={handleSaveForLater}
                disabled={saving || submitting}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
                tabIndex={6}
              >
                Save for Later
              </button>

              <button
                onClick={handleSubmit}
                disabled={submitting || saving || answeredCount === 0}
                className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
                tabIndex={5}
              >
                {submitting && (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                Submit Assessment
              </button>
            </div>
          </div>
        )}

        {/* Submit Screen Footer */}
        {showSubmitScreen && !loading && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ← Back to Questions
              </button>

              <button
                onClick={handleSaveForLater}
                disabled={submitting}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
              >
                Save for Later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
