"use client";

import { useState, useEffect, useCallback } from "react";

interface Progress {
  status: "not_started" | "in_progress" | "completed";
  totalQuestions: number;
  answeredCount: number;
  progressPercent: number;
  nextQuestion: {
    id: string;
    globalOrder: number;
    category: string;
  } | null;
  latestAssessment: {
    id: string;
    completedAt: string;
    conversationId: string | null;
    conversationTitle: string | null;
  } | null;
}

interface MaturityAssessmentWidgetProps {
  onStartAssessment: () => void;
}

export function MaturityAssessmentWidget({ onStartAssessment }: MaturityAssessmentWidgetProps) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  const loadProgress = useCallback(async () => {
    try {
      const response = await fetch("/api/maturity/progress");
      if (!response.ok) throw new Error("Failed to load progress");
      const data = await response.json();
      setProgress(data);
    } catch (error) {
      console.error("Error loading maturity progress:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg animate-pulse">
        <div className="w-4 h-4 bg-gray-300 rounded"></div>
        <div className="w-20 h-4 bg-gray-300 rounded"></div>
      </div>
    );
  }

  if (!progress) return null;

  // For not_started status, render a special shiny CTA
  if (progress.status === "not_started") {
    return (
      <div className="relative">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="group relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-lg"
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
            backgroundSize: "200% 200%",
            animation: "gradientShift 3s ease infinite",
          }}
        >
          {/* Animated shimmer effect */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
              animation: "shimmer 2s infinite",
            }}
          />

          {/* Sparkle icon */}
          <svg className="w-5 h-5 relative z-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
          </svg>

          <span className="relative z-10">Take GTM Assessment</span>

          {/* Pulsing dot indicator */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
        </button>

        {isExpanded && (
          <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
            {/* Gradient header */}
            <div
              className="px-4 py-3"
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              }}
            >
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
                </svg>
                GTM Maturity Assessment
              </h3>
            </div>

            <div className="p-4">
              <p className="text-gray-600 mb-4">
                Answer questions about your go-to-market strategy and get <span className="font-semibold text-purple-600">personalized recommendations</span> from Mikey to accelerate your sales.
              </p>

              <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Takes about 10-15 minutes</span>
              </div>

              <button
                onClick={() => {
                  setIsExpanded(false);
                  onStartAssessment();
                }}
                className="w-full py-3 px-4 text-white rounded-lg font-semibold text-sm transition-all hover:shadow-lg hover:scale-[1.02]"
                style={{
                  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                }}
              >
                Start Assessment
              </button>
            </div>
          </div>
        )}

        {/* Click outside to close */}
        {isExpanded && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsExpanded(false)}
          />
        )}

      </div>
    );
  }

  // In-progress and completed states
  const getStatusColor = () => {
    switch (progress.status) {
      case "in_progress":
        return "bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600 shadow-md";
      case "completed":
        return "bg-green-100 text-green-700 hover:bg-green-200";
    }
  };

  const getStatusIcon = () => {
    switch (progress.status) {
      case "in_progress":
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "completed":
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getStatusText = () => {
    switch (progress.status) {
      case "in_progress":
        return `${progress.progressPercent}% Complete`;
      case "completed":
        return "View Results";
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (progress.status === "completed" && progress.latestAssessment?.conversationId) {
            window.location.href = `/chat/${progress.latestAssessment.conversationId}`;
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${getStatusColor()}`}
      >
        {getStatusIcon()}
        <span>{getStatusText()}</span>
        {progress.status !== "completed" && (
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isExpanded && progress.status !== "completed" && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">GTM Maturity Assessment</h3>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;ve answered {progress.answeredCount} of {progress.totalQuestions} questions. Continue to get your recommendations.
            </p>

            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{progress.progressPercent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
                  style={{ width: `${progress.progressPercent}%` }}
                />
              </div>
            </div>

            <button
              onClick={() => {
                setIsExpanded(false);
                onStartAssessment();
              }}
              className="w-full py-2 px-4 bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded-lg hover:from-amber-500 hover:to-orange-600 font-medium text-sm transition-all"
            >
              Continue Assessment
            </button>
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}
