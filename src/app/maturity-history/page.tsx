"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface AssessmentListItem {
  id: string;
  title: string | null;
  completedAt: string;
  conversationId: string | null;
  answerCount: number;
}

interface QuestionAnswer {
  questionId: string;
  globalOrder: number;
  question: string;
  answer: string;
}

interface Category {
  name: string;
  questions: QuestionAnswer[];
}

interface AssessmentDetail {
  id: string;
  title: string | null;
  completedAt: string;
  conversationId: string | null;
  conversationTitle: string | null;
  categories: Category[];
}

export default function MaturityHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<AssessmentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Check auth and load assessment list
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

        // Load assessment list
        const res = await fetch("/api/maturity/history");
        const data = await res.json();
        if (data.assessments) {
          setAssessments(data.assessments);
          // Auto-select the first assessment
          if (data.assessments.length > 0) {
            setSelectedId(data.assessments[0].id);
          }
        }
      } catch (error) {
        console.error("Error loading assessments:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  // Load selected assessment details
  useEffect(() => {
    if (!selectedId) {
      setSelectedAssessment(null);
      return;
    }

    async function loadAssessment() {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/maturity/history?id=${selectedId}`);
        const data = await res.json();
        if (data.assessment) {
          setSelectedAssessment(data.assessment);
        }
      } catch (error) {
        console.error("Error loading assessment:", error);
      } finally {
        setLoadingDetail(false);
      }
    }
    loadAssessment();
  }, [selectedId]);

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/chat"
              className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Chat
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">GTM Maturity Assessment History</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex max-w-7xl mx-auto w-full">
        {assessments.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-gray-400 text-6xl mb-4">📊</div>
              <h2 className="text-xl font-medium text-gray-700 mb-2">No assessments yet</h2>
              <p className="text-gray-500 mb-4">Complete your first GTM Maturity Assessment to see it here.</p>
              <Link
                href="/chat"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Go to Chat
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Left Panel - Assessment List */}
            <div className="w-1/3 border-r border-gray-200 bg-white overflow-y-auto">
              <div className="p-4">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Completed Assessments
                </h2>
                <div className="space-y-2">
                  {assessments.map((assessment) => (
                    <button
                      key={assessment.id}
                      onClick={() => setSelectedId(assessment.id)}
                      className={`w-full text-left p-4 rounded-lg transition-colors ${
                        selectedId === assessment.id
                          ? "bg-blue-50 border-2 border-blue-500"
                          : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                      }`}
                    >
                      <div className="text-sm text-gray-500 mb-1">
                        {formatDate(assessment.completedAt)}
                      </div>
                      <div className="font-medium text-gray-900 line-clamp-2">
                        {assessment.title || "GTM Maturity Assessment"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {assessment.answerCount} questions answered
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Panel - Assessment Detail */}
            <div className="w-2/3 overflow-y-auto">
              {loadingDetail ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-500">Loading assessment...</div>
                </div>
              ) : selectedAssessment ? (
                <div className="p-6">
                  {/* Assessment Header */}
                  <div className="mb-6">
                    <div className="text-sm text-gray-500 mb-1">
                      {formatDate(selectedAssessment.completedAt)}
                    </div>
                    <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                      {selectedAssessment.title || "GTM Maturity Assessment"}
                    </h2>
                    {selectedAssessment.conversationId && (
                      <Link
                        href={`/chat/${selectedAssessment.conversationId}`}
                        className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        View AI Recommendations
                      </Link>
                    )}
                  </div>

                  {/* Questions and Answers by Category */}
                  {selectedAssessment.categories.length === 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
                      <div className="text-amber-600 text-4xl mb-3">📋</div>
                      <h3 className="text-lg font-medium text-amber-800 mb-2">
                        Answer history not available
                      </h3>
                      <p className="text-amber-700 text-sm mb-4">
                        This assessment was completed before we started saving answer snapshots.
                        Your responses are not available for this assessment.
                      </p>
                      {selectedAssessment.conversationId && (
                        <Link
                          href={`/chat/${selectedAssessment.conversationId}`}
                          className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"
                        >
                          View AI Recommendations Instead
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {selectedAssessment.categories.map((category) => (
                        <div key={category.name}>
                          <h3 className="text-lg font-medium text-gray-800 mb-4 pb-2 border-b border-gray-200">
                            {category.name}
                          </h3>
                          <div className="space-y-6">
                            {category.questions.map((qa) => (
                              <div key={qa.questionId} className="bg-gray-50 rounded-lg p-4">
                                <div className="text-sm font-medium text-gray-700 mb-2">
                                  Q{qa.globalOrder}: {qa.question}
                                </div>
                                {qa.answer ? (
                                  <div className="text-gray-900 prose prose-sm max-w-none">
                                    <ReactMarkdown>{qa.answer}</ReactMarkdown>
                                  </div>
                                ) : (
                                  <div className="text-gray-400 italic">Not answered</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-500">Select an assessment to view details</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
