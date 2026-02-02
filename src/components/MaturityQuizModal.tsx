"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
}

export function MaturityQuizModal({ isOpen, onClose, onComplete }: MaturityQuizModalProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveNextButtonRef = useRef<HTMLButtonElement>(null);

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

        // Find first unanswered question to start at
        const firstUnanswered = data.questions.findIndex(
          (q: Question) => !q.latestAnswer
        );
        setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
      } catch (error) {
        console.error("Error loading questions:", error);
      } finally {
        setLoading(false);
      }
    }

    loadQuestions();
  }, [isOpen]);

  // Set current answer when question changes
  useEffect(() => {
    if (questions[currentIndex]?.latestAnswer) {
      setCurrentAnswer(questions[currentIndex].latestAnswer.answer);
    } else {
      setCurrentAnswer("");
    }
  }, [currentIndex, questions]);

  // Focus textarea when loading completes or question changes
  useEffect(() => {
    if (!loading && isOpen) {
      focusTextarea();
    }
  }, [currentIndex, loading, isOpen, focusTextarea]);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = questions.filter((q) => q.latestAnswer).length;
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

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

      // Move to next question if requested and not at end
      if (advanceToNext && currentIndex < totalQuestions - 1) {
        setCurrentIndex(currentIndex + 1);
      }

      // Refocus textarea after save
      focusTextarea();
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
    }
  }, [currentAnswer, handleSave, currentIndex, totalQuestions]);

  const handleSkip = useCallback(() => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, totalQuestions]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const handleSaveForLater = useCallback(async () => {
    // Save current answer if there is one
    if (currentAnswer.trim() && currentQuestion) {
      await handleSave(false);
    }
    onClose();
  }, [currentAnswer, currentQuestion, handleSave, onClose]);

  const handleSubmit = useCallback(async () => {
    // If there's unsaved content, save it first
    if (currentAnswer.trim() && currentQuestion) {
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
  }, [currentAnswer, currentQuestion, handleSave, onComplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

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
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">GTM Maturity Assessment</h2>
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
              <span>{answeredCount} of {totalQuestions} answered</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Category indicator */}
          {currentQuestion && (
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
          ) : currentQuestion ? (
            <div>
              <div className="mb-2 text-sm text-gray-500">
                Question {currentIndex + 1} of {totalQuestions}
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {currentQuestion.question}
              </h3>
              <textarea
                ref={textareaRef}
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder="Enter your answer..."
                className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No questions available.
            </div>
          )}
        </div>

        {/* Navigation Footer */}
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
              <button
                onClick={handleSkip}
                disabled={currentIndex >= totalQuestions - 1 || saving}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                tabIndex={3}
              >
                Skip
              </button>
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
                {currentAnswer.trim() ? "Save & Next" : "Next"}
              </button>
            </div>
          </div>
        </div>

        {/* Action Footer - Always visible */}
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
      </div>
    </div>
  );
}
