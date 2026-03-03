"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyMarkdownAsRichText } from "@/lib/clipboard";

interface ResearchBrief {
  id: string;
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  content: string;
  sources: { title: string; url: string }[];
  source: string;
  createdAt: string;
}

interface HistoryItem {
  id: string;
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  source: string;
  createdAt: string;
}

export default function PreCallPlanningHistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading history...</p>
        </div>
      </div>
    }>
      <HistoryContent />
    </Suspense>
  );
}

function HistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<ResearchBrief | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadBrief = useCallback(async (id: string) => {
    if (selectedBrief?.id === id) return;
    setLoadingBrief(true);
    try {
      const response = await fetch(`/api/pre-call-planning/research/${id}`);
      if (!response.ok) throw new Error("Failed to load");
      const data = await response.json();
      setSelectedBrief({
        id: data.research.id,
        companyName: data.research.companyName,
        contactName: data.research.contactName,
        contactTitle: data.research.contactTitle,
        content: data.research.content,
        sources: data.research.sources as { title: string; url: string }[],
        source: data.research.source,
        createdAt: data.research.createdAt,
      });
    } catch (error) {
      console.error("Error loading brief:", error);
    } finally {
      setLoadingBrief(false);
    }
  }, [selectedBrief?.id]);

  useEffect(() => {
    document.title = "Pre-Call Planning History - Mikey";
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

        const historyRes = await fetch("/api/pre-call-planning/research/history");
        if (historyRes.ok) {
          const data = await historyRes.json();
          setHistory(data.researches || []);

          // Auto-load brief from URL param
          const idFromUrl = searchParams.get("id");
          if (idFromUrl) {
            loadBrief(idFromUrl);
          }
        }
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, searchParams, loadBrief]);

  const handleSelectBrief = (id: string) => {
    // Update URL with selected brief ID
    router.push(`/pre-call-planning/history?id=${id}`, { scroll: false });
    loadBrief(id);
  };

  const handleCopy = async () => {
    if (!selectedBrief) return;
    const success = await copyMarkdownAsRichText(selectedBrief.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  const getBriefTitle = (item: HistoryItem) => {
    if (item.contactName) {
      return `${item.companyName} - ${item.contactName}`;
    }
    return item.companyName;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/pre-call-planning"
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Pre-Call Planning History</h1>
                <p className="text-sm text-gray-500">
                  {history.length} research brief{history.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            {selectedBrief && (
              <button
                onClick={handleCopy}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                {copied ? (
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
                    Copy Brief
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {history.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Research History Yet</h2>
            <p className="text-gray-600 mb-6">
              Research a prospect to see your history here.
            </p>
            <Link
              href="/pre-call-planning/research"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Research a Prospect
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: History List */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {history.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectBrief(item.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                      selectedBrief?.id === item.id
                        ? "bg-purple-50 border-l-4 border-l-purple-500"
                        : ""
                    }`}
                  >
                    <div className="font-medium text-gray-900 text-sm">
                      {getBriefTitle(item)}
                    </div>
                    {item.contactTitle && (
                      <div className="text-xs text-gray-500 mt-0.5">{item.contactTitle}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                      <span>{formatDate(item.createdAt)}</span>
                      {item.source === "slack" && (
                        <span className="text-purple-500">via Slack</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono">{item.id}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Brief Display */}
            <div className="lg:col-span-2">
              {loadingBrief ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                  <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-gray-500">Loading brief...</p>
                </div>
              ) : selectedBrief ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {selectedBrief.companyName}
                      {selectedBrief.contactName && (
                        <span className="text-gray-500 font-normal"> — {selectedBrief.contactName}</span>
                      )}
                    </h2>
                    <p className="text-sm text-gray-500">
                      Generated {formatDate(selectedBrief.createdAt)}
                      {selectedBrief.source === "slack" && " via Slack"}
                    </p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">ID: {selectedBrief.id}</p>
                  </div>
                  <div className="p-6">
                    <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedBrief.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                  <div className="text-6xl mb-4">📋</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Select a Research Brief</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Click on a company from the list to view the full research brief.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
