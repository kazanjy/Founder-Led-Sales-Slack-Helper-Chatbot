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

  const getStatusColor = () => {
    switch (progress.status) {
      case "not_started":
        return "bg-gray-100 text-gray-700 hover:bg-gray-200";
      case "in_progress":
        return "bg-yellow-100 text-yellow-700 hover:bg-yellow-200";
      case "completed":
        return "bg-green-100 text-green-700 hover:bg-green-200";
    }
  };

  const getStatusIcon = () => {
    switch (progress.status) {
      case "not_started":
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        );
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
      case "not_started":
        return "GTM Assessment";
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
            // Navigate to the recommendations conversation
            window.location.href = `/chat/${progress.latestAssessment.conversationId}`;
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${getStatusColor()}`}
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
        <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">GTM Maturity Assessment</h3>
            <p className="text-sm text-gray-600 mb-4">
              {progress.status === "not_started"
                ? "Answer questions about your go-to-market strategy to get personalized recommendations from Mikey."
                : `You've answered ${progress.answeredCount} of ${progress.totalQuestions} questions. Continue to get your recommendations.`}
            </p>

            {progress.status === "in_progress" && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Progress</span>
                  <span>{progress.progressPercent}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 transition-all duration-300"
                    style={{ width: `${progress.progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setIsExpanded(false);
                onStartAssessment();
              }}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors"
            >
              {progress.status === "not_started" ? "Start Assessment" : "Continue Assessment"}
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
