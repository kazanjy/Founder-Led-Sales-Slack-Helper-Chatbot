"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import ChatWithAssessmentModal from "@/components/ChatWithAssessmentModal";

interface AssessmentListItem {
  id: string;
  title: string | null;
  completedAt: string;
  conversationId: string | null;
  answerCount: number;
  status: "completed" | "in_progress";
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
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<AssessmentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatAssessmentId, setChatAssessmentId] = useState<string | null>(null);

  const openChatModal = (assessmentId: string) => {
    setChatAssessmentId(assessmentId);
    setShowChatModal(true);
  };

  const handleChatWithAssessment = async (userPrompt: string) => {
    if (!chatAssessmentId) return;
    setStartingChat(true);
    try {
      const res = await fetch("/api/maturity/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: chatAssessmentId, userPrompt }),
      });
      const data = await res.json();
      if (res.ok && data.conversationId) {
        setShowChatModal(false);
        router.push(`/chat/${data.conversationId}`);
      } else {
        console.error("Failed to start chat:", data.error);
      }
    } catch (error) {
      console.error("Error starting chat with assessment:", error);
    } finally {
      setStartingChat(false);
    }
  };

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
          if (data.totalQuestions) {
            setTotalQuestions(data.totalQuestions);
          }
          // Auto-select the first completed assessment (not in-progress)
          const firstCompleted = data.assessments.find((a: AssessmentListItem) => a.status === "completed");
          if (firstCompleted) {
            setSelectedId(firstCompleted.id);
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
    if (!selectedId || selectedId === "in-progress") {
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
          <Link
            href="/assessment/bulk?mode=update"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-medium text-sm transition-all shadow-sm hover:shadow-md"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Update Assessment
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex max-w-7xl mx-auto w-full">
        {assessments.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-gray-400 text-6xl mb-4">📊</div>
              <h2 className="text-xl font-medium text-gray-700 mb-2">No assessments yet</h2>
              <p className="text-gray-500 mb-6">Complete your first GTM Maturity Assessment to see it here.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/assessment/bulk"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-medium transition-all shadow-md hover:shadow-lg"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
                  </svg>
                  Start Assessment
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex items-center px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Or go to Chat
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Left Panel - Assessment List */}
            <div className="w-1/3 border-r border-gray-200 bg-white overflow-y-auto">
              <div className="p-4">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Your Assessments
                </h2>
                <div className="space-y-2">
                  {assessments.map((assessment) => {
                    // In-progress assessment - render as a link to bulk mode
                    if (assessment.status === "in_progress") {
                      const progressPercent = totalQuestions > 0
                        ? Math.round((assessment.answerCount / totalQuestions) * 100)
                        : 0;

                      return (
                        <Link
                          key={assessment.id}
                          href="/assessment/bulk"
                          className="block w-full text-left p-4 rounded-lg transition-colors bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 hover:border-amber-400"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 bg-amber-500 text-white text-xs font-medium rounded-full">
                              In Progress
                            </span>
                          </div>
                          <div className="font-medium text-gray-900 mb-2">
                            GTM Maturity Assessment
                          </div>
                          <div className="mb-2">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>{assessment.answerCount} of {totalQuestions} questions</span>
                              <span>{progressPercent}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-xs text-amber-700 font-medium">
                            Click to continue →
                          </div>
                        </Link>
                      );
                    }

                    // Completed assessment
                    return (
                      <button
                        key={assessment.id}
                        onClick={() => setSelectedId(assessment.id)}
                        className={`w-full text-left p-4 rounded-lg transition-colors ${
                          selectedId === assessment.id
                            ? "bg-blue-50 border-2 border-blue-500"
                            : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm text-gray-500">
                            {formatDate(assessment.completedAt)}
                          </span>
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                            Completed
                          </span>
                        </div>
                        <div className="font-medium text-gray-900 line-clamp-2">
                          {assessment.title || "GTM Maturity Assessment"}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {assessment.answerCount} questions answered
                        </div>
                      </button>
                    );
                  })}
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
                    <div className="flex items-center gap-4 flex-wrap">
                      {selectedAssessment.conversationId && (
                        <Link
                          href={`/chat/${selectedAssessment.conversationId}`}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          View AI Recommendations
                        </Link>
                      )}
                      <button
                        onClick={() => openChatModal(selectedAssessment.id)}
                        className="inline-flex items-center text-green-600 hover:text-green-800 text-sm"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        Chat With Assessment
                      </button>
                    </div>
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
                      {selectedAssessment.categories.map((category, categoryIndex) => (
                        <div key={category.name} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                          {/* Category Header */}
                          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4 border-b border-gray-200">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                                {categoryIndex + 1}
                              </div>
                              <h3 className="text-lg font-semibold text-gray-800">
                                {category.name}
                              </h3>
                              <span className="text-sm text-gray-500 ml-auto">
                                {category.questions.length} questions
                              </span>
                            </div>
                          </div>

                          {/* Questions in this category */}
                          <div className="divide-y divide-gray-100">
                            {category.questions.map((qa) => (
                              <div key={qa.questionId} className="p-5 hover:bg-gray-50 transition-colors">
                                {/* Question */}
                                <div className="flex gap-3 mb-3">
                                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-medium flex items-center justify-center">
                                    {qa.globalOrder}
                                  </span>
                                  <p className="text-gray-700 font-medium leading-relaxed">
                                    {qa.question}
                                  </p>
                                </div>

                                {/* Answer */}
                                {qa.answer ? (
                                  <div className="ml-10 pl-4 border-l-2 border-blue-200 bg-blue-50/50 rounded-r-lg py-3 pr-4">
                                    <div className="text-gray-800 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                                      <ReactMarkdown>{qa.answer}</ReactMarkdown>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="ml-10 pl-4 text-gray-400 italic text-sm">
                                    Not answered
                                  </div>
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

      {/* Chat with Assessment Modal */}
      <ChatWithAssessmentModal
        isOpen={showChatModal}
        onClose={() => {
          setShowChatModal(false);
          setChatAssessmentId(null);
        }}
        onSubmit={handleChatWithAssessment}
        isLoading={startingChat}
        assessmentTitle={selectedAssessment?.title || undefined}
      />
    </div>
  );
}
