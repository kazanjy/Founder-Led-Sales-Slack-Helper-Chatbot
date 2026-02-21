"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface NarrativeVersion {
  id: string;
  narrative: string;
  description100w: string;
  description50w: string;
  description25w: string;
  createdAt: string;
}

interface AnswersByCategory {
  [category: string]: Array<{
    questionId: string;
    globalOrder: number;
    question: string;
    answer: string;
  }>;
}

export default function SalesNarrativePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SalesNarrativeContent />
    </Suspense>
  );
}

function SalesNarrativeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState<NarrativeVersion | null>(null);
  const [answersByCategory, setAnswersByCategory] = useState<AnswersByCategory | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"qa" | "narrative" | "100w" | "50w" | "25w">("narrative");

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedNarrative, setEditedNarrative] = useState("");
  const [edited100w, setEdited100w] = useState("");
  const [edited50w, setEdited50w] = useState("");
  const [edited25w, setEdited25w] = useState("");

  // Set browser tab title
  useEffect(() => {
    document.title = "Sales Narrative - Mikey";
  }, []);

  // Load the latest version or specific version
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

        // Load specific version or latest
        let url = "/api/sales-narrative/latest";
        if (versionId) {
          url = `/api/sales-narrative/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to load narrative");

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          setAnswersByCategory(data.answersByCategory || null);
          initEditFields(data.version);
        } else {
          if (data.hasNarrative) {
            setVersion(data.version);
            setAnswersByCategory(data.answersByCategory || null);
            initEditFields(data.version);
          } else {
            // No narrative yet, redirect to edit
            router.push("/sales-narrative/edit");
            return;
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, versionId]);

  const initEditFields = (v: NarrativeVersion) => {
    setEditedNarrative(v.narrative);
    setEdited100w(v.description100w);
    setEdited50w(v.description50w);
    setEdited25w(v.description25w);
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleStartEditing = () => {
    if (version) {
      initEditFields(version);
    }
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (version) {
      initEditFields(version);
    }
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!version) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/sales-narrative/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narrative: editedNarrative,
          description100w: edited100w,
          description50w: edited50w,
          description25w: edited25w,
        }),
      });

      if (!response.ok) throw new Error("Failed to save");

      const data = await response.json();
      setVersion(data.version);
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving:", error);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getWordCount = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading narrative...</p>
        </div>
      </div>
    );
  }

  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-4">📝</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No Narrative Yet</h1>
          <p className="text-gray-600 mb-6">
            Answer the sales narrative questionnaire to generate your compelling sales narrative and value propositions.
          </p>
          <Link
            href="/sales-narrative/edit"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Start Questionnaire
          </Link>
        </div>
      </div>
    );
  }

  // Get current content (edited or original)
  const currentNarrative = isEditing ? editedNarrative : version.narrative;
  const current100w = isEditing ? edited100w : version.description100w;
  const current50w = isEditing ? edited50w : version.description50w;
  const current25w = isEditing ? edited25w : version.description25w;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
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
                <h1 className="text-xl font-semibold text-gray-900">Sales Narrative</h1>
                <p className="text-sm text-gray-500">
                  Generated {formatDate(version.createdAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancelEditing}
                    disabled={saving}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save Changes
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleStartEditing}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  <Link
                    href="/sales-narrative/history"
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </Link>
                  <Link
                    href="/sales-narrative/edit"
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab("qa")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "qa"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Q&A Inputs
          </button>
          <button
            onClick={() => setActiveTab("narrative")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "narrative"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Full Narrative
          </button>
          <button
            onClick={() => setActiveTab("100w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "100w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            100 Words
          </button>
          <button
            onClick={() => setActiveTab("50w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "50w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            50 Words
          </button>
          <button
            onClick={() => setActiveTab("25w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "25w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            25 Words
          </button>
        </div>

        {/* Content */}
        {activeTab === "qa" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Questionnaire Answers</h2>
              <p className="text-sm text-gray-500">
                The inputs used to generate this narrative
              </p>
            </div>
            <div className="p-6 space-y-6">
              {answersByCategory ? (
                ["Product", "Problem", "Solution", "Proof", "Business"].map((category) => {
                  const answers = answersByCategory[category];
                  if (!answers || answers.length === 0) return null;

                  const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
                    Product: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700" },
                    Problem: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
                    Solution: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
                    Proof: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
                    Business: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
                  };

                  const colors = categoryColors[category] || { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700" };

                  return (
                    <div key={category} className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
                      <h3 className={`font-semibold ${colors.text} mb-3`}>{category}</h3>
                      <div className="space-y-4">
                        {answers.map((qa) => (
                          <div key={qa.questionId} className="bg-white rounded-lg p-4 border border-gray-100">
                            <p className="text-sm font-medium text-gray-700 mb-2">
                              Q{qa.globalOrder}: {qa.question}
                            </p>
                            <p className="text-gray-800 whitespace-pre-wrap">
                              {qa.answer || <span className="text-gray-400 italic">Not answered</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-gray-500 text-center py-8">No questionnaire data available for this version.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "narrative" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="font-semibold text-gray-900">Full Sales Narrative</h2>
                <p className="text-sm text-gray-500">
                  {getWordCount(currentNarrative)} words
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(currentNarrative, "narrative")}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedField === "narrative" ? (
                    <>
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-6">
              {isEditing ? (
                <textarea
                  value={editedNarrative}
                  onChange={(e) => setEditedNarrative(e.target.value)}
                  className="w-full min-h-[400px] p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 font-normal"
                />
              ) : (
                <div className="prose prose-gray max-w-none whitespace-pre-wrap">
                  {currentNarrative}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "100w" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="font-semibold text-gray-900">100-Word Description</h2>
                <p className="text-sm text-gray-500">
                  {getWordCount(current100w)} words - Product marketing summary
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current100w, "100w")}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedField === "100w" ? (
                    <>
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-6">
              {isEditing ? (
                <textarea
                  value={edited100w}
                  onChange={(e) => setEdited100w(e.target.value)}
                  className="w-full min-h-[150px] p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
                />
              ) : (
                <div className="text-lg text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {current100w}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "50w" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="font-semibold text-gray-900">50-Word Elevator Pitch</h2>
                <p className="text-sm text-gray-500">
                  {getWordCount(current50w)} words - ~20 second spoken pitch
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current50w, "50w")}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedField === "50w" ? (
                    <>
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-6">
              {isEditing ? (
                <textarea
                  value={edited50w}
                  onChange={(e) => setEdited50w(e.target.value)}
                  className="w-full min-h-[100px] p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
                />
              ) : (
                <div className="text-xl text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {current50w}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "25w" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="font-semibold text-gray-900">25-Word Tagline</h2>
                <p className="text-sm text-gray-500">
                  {getWordCount(current25w)} words - One-liner
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current25w, "25w")}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedField === "25w" ? (
                    <>
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="p-6">
              {isEditing ? (
                <textarea
                  value={edited25w}
                  onChange={(e) => setEdited25w(e.target.value)}
                  className="w-full min-h-[80px] p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
                />
              ) : (
                <div className="text-2xl font-medium text-gray-900 leading-relaxed whitespace-pre-wrap">
                  {current25w}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Access Cards - only show when not editing */}
        {!isEditing && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700">100 Words</span>
                <button
                  onClick={() => handleCopy(current100w, "100w-card")}
                  className="text-blue-600 hover:text-blue-800"
                >
                  {copiedField === "100w-card" ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-700">{current100w}</p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-green-700">50 Words</span>
                <button
                  onClick={() => handleCopy(current50w, "50w-card")}
                  className="text-green-600 hover:text-green-800"
                >
                  {copiedField === "50w-card" ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-700">{current50w}</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-purple-700">25 Words</span>
                <button
                  onClick={() => handleCopy(current25w, "25w-card")}
                  className="text-purple-600 hover:text-purple-800"
                >
                  {copiedField === "25w-card" ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-700">{current25w}</p>
            </div>
          </div>
        )}

        {/* CTAs - only show when not editing */}
        {!isEditing && (
          <div className="mt-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-white">
            <h3 className="text-xl font-bold mb-2">What&apos;s Next?</h3>
            <p className="text-purple-100 mb-6">
              Use your sales narrative to create more GTM assets with Mikey.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="px-5 py-2.5 bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Chat About It
              </Link>
              <Link
                href="/assessment/bulk"
                className="px-5 py-2.5 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                GTM Assessment
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
