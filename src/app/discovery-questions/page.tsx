"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface DiscoveryQuestion {
  primary: string;
  followUps: string[];
}

interface Category {
  name: string;
  description: string;
  questions: DiscoveryQuestion[];
}

interface DiscoveryQuestionsContent {
  categories: Category[];
}

interface DiscoveryQuestionsVersion {
  id: string;
  content: DiscoveryQuestionsContent;
  salesNarrativeVersionId: string;
  salesNarrative?: {
    id: string;
    narrative: string;
    createdAt: string;
  };
  createdAt: string;
}

export default function DiscoveryQuestionsPage() {
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
      <DiscoveryQuestionsContent />
    </Suspense>
  );
}

function DiscoveryQuestionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [version, setVersion] = useState<DiscoveryQuestionsVersion | null>(null);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [copiedQuestion, setCopiedQuestion] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.title = "Discovery Questions - Mikey";
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        let url = "/api/discovery-questions/latest";
        if (versionId) {
          url = `/api/discovery-questions/versions/${versionId}`;
        }

        const response = await fetch(url);

        if (!response.ok) {
          // API might fail if table doesn't exist yet - check for sales narrative directly
          const narrativeRes = await fetch("/api/sales-narrative/latest");
          if (narrativeRes.ok) {
            const narrativeData = await narrativeRes.json();
            setHasSalesNarrative(narrativeData.hasNarrative || false);
          }
          return;
        }

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          // Expand all categories by default
          if (data.version?.content?.categories) {
            setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
          }
        } else {
          setHasSalesNarrative(data.hasSalesNarrative);
          if (data.hasDiscoveryQuestions) {
            setVersion(data.version);
            if (data.version?.content?.categories) {
              setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
            }
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
        // Try to check for sales narrative even if main call failed
        try {
          const narrativeRes = await fetch("/api/sales-narrative/latest");
          if (narrativeRes.ok) {
            const narrativeData = await narrativeRes.json();
            setHasSalesNarrative(narrativeData.hasNarrative || false);
          }
        } catch {
          // Ignore
        }
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, versionId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/discovery-questions/generate", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to generate discovery questions");
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      if (data.version?.content?.categories) {
        setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
      }
    } catch (error) {
      console.error("Error generating:", error);
      alert("Failed to generate discovery questions. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyQuestion = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedQuestion(id);
      setTimeout(() => setCopiedQuestion(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleCopyAll = async () => {
    if (!version?.content?.categories) return;

    let allQuestions = "";
    for (const category of version.content.categories) {
      allQuestions += `## ${category.name}\n\n`;
      for (let i = 0; i < category.questions.length; i++) {
        const q = category.questions[i];
        allQuestions += `${i + 1}. ${q.primary}\n`;
        if (q.followUps?.length > 0) {
          for (const followUp of q.followUps) {
            allQuestions += `   - ${followUp}\n`;
          }
        }
        allQuestions += "\n";
      }
    }

    try {
      await navigator.clipboard.writeText(allQuestions.trim());
      setCopiedQuestion("all");
      setTimeout(() => setCopiedQuestion(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const toggleCategory = (name: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedCategories(newExpanded);
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

  const getTotalQuestions = () => {
    if (!version?.content?.categories) return 0;
    return version.content.categories.reduce((acc, cat) => acc + cat.questions.length, 0);
  };

  const categoryColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    "Problem Discovery": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: "text-red-500" },
    "Current State": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "text-blue-500" },
    "Impact & Urgency": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: "text-orange-500" },
    "Decision Process": { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", icon: "text-purple-500" },
    "Fit Qualification": { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", icon: "text-green-500" },
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading discovery questions...</p>
        </div>
      </div>
    );
  }

  // No sales narrative - need to create one first
  if (!hasSalesNarrative && !version) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-4">📝</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Narrative Required</h1>
          <p className="text-gray-600 mb-6">
            Discovery questions are generated from your sales narrative. Create a sales narrative first to get started.
          </p>
          <Link
            href="/sales-narrative/edit"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Create Sales Narrative
          </Link>
        </div>
      </div>
    );
  }

  // Has sales narrative but no discovery questions yet
  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Generate Discovery Questions</h1>
          <p className="text-gray-600 mb-6">
            Generate a set of discovery questions based on your sales narrative to use during sales calls.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Discovery Questions
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

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
                <h1 className="text-xl font-semibold text-gray-900">Discovery Questions</h1>
                <p className="text-sm text-gray-500">
                  Generated {formatDate(version.createdAt)} · {getTotalQuestions()} questions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCopyAll}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                {copiedQuestion === "all" ? (
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
                    Copy All
                  </>
                )}
              </button>
              <Link
                href="/discovery-questions/history"
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                History
              </Link>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="space-y-4">
          {version.content.categories.map((category) => {
            const colors = categoryColors[category.name] || { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700", icon: "text-gray-500" };
            const isExpanded = expandedCategories.has(category.name);

            return (
              <div key={category.name} className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
                <button
                  onClick={() => toggleCategory(category.name)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${colors.text}`}>{category.name}</span>
                    <span className="text-sm text-gray-500">
                      {category.questions.length} questions
                    </span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-4 space-y-3">
                    {category.description && (
                      <p className="text-sm text-gray-600 italic">{category.description}</p>
                    )}
                    {category.questions.map((question, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-4 border border-gray-100 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-gray-800 font-medium">
                              {idx + 1}. {question.primary}
                            </p>
                            {question.followUps && question.followUps.length > 0 && (
                              <div className="mt-2 pl-4 border-l-2 border-gray-200 space-y-1">
                                {question.followUps.map((followUp, fIdx) => (
                                  <p key={fIdx} className="text-sm text-gray-600">
                                    → {followUp}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              const fullQuestion = question.followUps?.length
                                ? `${question.primary}\n${question.followUps.map(f => `  - ${f}`).join("\n")}`
                                : question.primary;
                              handleCopyQuestion(fullQuestion, `${category.name}-${idx}`);
                            }}
                            className="text-gray-400 hover:text-gray-600 p-1"
                            title="Copy question"
                          >
                            {copiedQuestion === `${category.name}-${idx}` ? (
                              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Source Info */}
        {version.salesNarrative && (
          <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Generated From
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-800 font-medium">Sales Narrative</p>
                <p className="text-sm text-gray-500">
                  Created {formatDate(version.salesNarrative.createdAt)}
                </p>
              </div>
              <Link
                href={`/sales-narrative?version=${version.salesNarrativeVersionId}`}
                className="text-purple-600 hover:text-purple-700 text-sm font-medium"
              >
                View Narrative →
              </Link>
            </div>
          </div>
        )}

        {/* What's Next */}
        <div className="mt-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-white">
          <h3 className="text-xl font-bold mb-2">What&apos;s Next?</h3>
          <p className="text-purple-100 mb-6">
            Use these discovery questions during your sales calls to better understand prospects.
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
              href="/sales-narrative"
              className="px-5 py-2.5 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Sales Narrative
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
