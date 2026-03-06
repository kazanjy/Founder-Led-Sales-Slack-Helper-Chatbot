"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { ChatAboutButton } from "@/components/ChatAboutButton";

interface ResearchBrief {
  id: string;
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  content: string;
  sources: { title: string; url: string }[];
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

interface ProgressUpdate {
  stage: string;
  message: string;
  progress: number;
}

export default function PreCallResearchPage() {
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
      <ResearchContent />
    </Suspense>
  );
}

function ResearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [hasPreCallPlanning, setHasPreCallPlanning] = useState(false);
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactLinkedIn, setContactLinkedIn] = useState("");
  const [urls, setUrls] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const loadBriefById = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/pre-call-planning/research/${id}`);
      if (!response.ok) throw new Error("Failed to load");
      const data = await response.json();
      setBrief({
        id: data.research.id,
        companyName: data.research.companyName,
        contactName: data.research.contactName,
        contactTitle: data.research.contactTitle,
        content: data.research.content,
        sources: data.research.sources as { title: string; url: string }[],
        createdAt: data.research.createdAt,
      });
    } catch (error) {
      console.error("Error loading brief:", error);
    }
  }, []);

  useEffect(() => {
    document.title = "Pre-Call Research - Mikey";
  }, []);

  // Load history and check if planning process exists
  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        // Check if user has generated their planning process
        const pcpRes = await fetch("/api/pre-call-planning/latest");
        if (pcpRes.ok) {
          const pcpData = await pcpRes.json();
          setHasPreCallPlanning(!!pcpData.hasPreCallPlanning);
        }

        const historyRes = await fetch("/api/pre-call-planning/research/history");
        if (historyRes.ok) {
          const data = await historyRes.json();
          setHistory(data.researches || []);
        }

        // Auto-load brief from URL param
        const idFromUrl = searchParams.get("id");
        if (idFromUrl) {
          loadBriefById(idFromUrl);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, searchParams, loadBriefById]);

  const handleResearch = async () => {
    if (!companyName.trim()) {
      await showAlert({
        title: "Company Required",
        message: "Please enter a company name to research.",
        variant: "danger",
      });
      return;
    }

    setResearching(true);
    setProgress({ stage: "parsing", message: "Starting research...", progress: 5 });
    setBrief(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const homepageUrl = urls.trim();

      const response = await fetch("/api/pre-call-planning/research-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          contactName: contactName.trim() || undefined,
          contactTitle: contactTitle.trim() || undefined,
          contactLinkedIn: contactLinkedIn.trim() || undefined,
          urls: homepageUrl ? [homepageUrl] : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Research failed (${response.status})`;
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // Response may not be JSON (e.g. 405 with empty body)
        }
        throw new Error(errorMessage);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let eventData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            if (line.startsWith("data: ")) eventData = line.slice(6);
          }

          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            if (eventType === "progress") {
              setProgress(parsed);
            } else if (eventType === "complete") {
              setBrief(parsed);
              setProgress(null);
              // Update URL with the new brief ID
              router.replace(`/pre-call-planning/research?id=${parsed.id}`, { scroll: false });
              // Add to history
              setHistory((prev) => [
                {
                  id: parsed.id,
                  companyName: parsed.companyName,
                  contactName: parsed.contactName,
                  source: "web",
                  createdAt: parsed.createdAt,
                },
                ...prev,
              ]);
            } else if (eventType === "error") {
              throw new Error(parsed.message);
            }
          } catch (parseError) {
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("Research error:", error);
      setProgress(null);
      await showAlert({
        title: "Research Failed",
        message: (error as Error).message || "Failed to complete research. Please try again.",
        variant: "danger",
      });
    } finally {
      setResearching(false);
      abortRef.current = null;
    }
  };

  const handleLoadBrief = async (id: string) => {
    router.replace(`/pre-call-planning/research?id=${id}`, { scroll: false });
    await loadBriefById(id);
  };

  const handleCopy = async () => {
    if (!brief) return;
    const success = await copyMarkdownAsRichText(brief.content);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Gate: require planning process to be generated first
  if (!hasPreCallPlanning) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">🎯</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Set Up Your Pre-Call Checklist First</h1>
            <p className="text-gray-600 mb-6">
              Before you can research prospects, you need to generate your Pre-Call Checklist. This creates a personalized preparation framework based on your First Call Checklist.
            </p>
            <Link
              href="/pre-call-planning"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Pre-Call Checklist
            </Link>
            <p className="text-sm text-gray-400 mt-4">
              Once your pre-call checklist is ready, you can come back here to research any prospect.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
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
                <h1 className="text-xl font-semibold text-gray-900">Pre-Call Research</h1>
                <p className="text-sm text-gray-500">Research prospects before every sales call</p>
              </div>
            </div>
            {brief && (
              <div className="flex items-center gap-2">
              <ChatAboutButton
                title={`Chat About Pre-Call Research: ${brief.companyName}`}
                getContext={() => brief?.content || ""}
              />
              <ShareDocumentButton
                documentType="preCallResearch"
                documentId={brief.id}
                title={`Pre-Call Research: ${brief.companyName}${brief.contactName ? ` - ${brief.contactName}` : ""}${brief.contactTitle ? `, ${brief.contactTitle}` : ""}`}
                content={brief.content}
              />
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
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Research Form + History */}
          <div className="lg:col-span-1 space-y-6">
            {/* Research Form */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">New Research</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g., Acme Corp"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g., Jane Doe"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={contactTitle}
                    onChange={(e) => setContactTitle(e.target.value)}
                    placeholder="e.g., VP of Engineering"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    LinkedIn URL
                  </label>
                  <input
                    type="url"
                    value={contactLinkedIn}
                    onChange={(e) => setContactLinkedIn(e.target.value)}
                    placeholder="https://linkedin.com/in/janedoe"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-sm"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company Homepage URL
                  </label>
                  <input
                    type="url"
                    value={urls}
                    onChange={(e) => setUrls(e.target.value)}
                    placeholder="https://acme.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-sm"
                    disabled={researching}
                  />
                </div>

                <button
                  onClick={handleResearch}
                  disabled={researching || !companyName.trim()}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {researching ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Researching...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      Research Prospect
                    </>
                  )}
                </button>
              </div>

              {/* Progress bar */}
              {progress && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">{progress.message}</span>
                    <span className="text-sm text-gray-400">{progress.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Recent Research</h2>
                  <Link
                    href="/pre-call-planning/history"
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    View All
                  </Link>
                </div>
                <div className="space-y-2">
                  {history.slice(0, 10).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleLoadBrief(item.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors ${
                        brief?.id === item.id ? "bg-purple-50 border border-purple-200" : ""
                      }`}
                    >
                      <div className="font-medium text-gray-900 text-sm">{item.companyName}</div>
                      {item.contactName && (
                        <div className="text-xs text-gray-500">{item.contactName}{item.contactTitle ? ` - ${item.contactTitle}` : ""}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(item.createdAt)}
                        {item.source === "slack" && (
                          <span className="ml-1 text-purple-500">via Slack</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Research Brief Display */}
          <div className="lg:col-span-2">
            {brief ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {brief.companyName}
                    {brief.contactName && (
                      <span className="text-gray-500 font-normal"> — {brief.contactName}{brief.contactTitle ? `, ${brief.contactTitle}` : ""}</span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500">
                    Generated {formatDate(brief.createdAt)}
                  </p>
                </div>
                <div className="p-6">
                  <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : researching ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <svg className="animate-spin h-12 w-12 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Researching...</h3>
                <p className="text-gray-500">{progress?.message || "Starting search..."}</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Research a Prospect</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  Enter a company name and optional contact info to generate a comprehensive research brief for your next sales call.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {ConfirmModalElement}
    </div>
  );
}
