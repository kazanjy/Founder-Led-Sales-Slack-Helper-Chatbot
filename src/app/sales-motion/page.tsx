"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { SidebarAdCards } from "@/components/SidebarAdCards";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SalesMotionCallData {
  id: string;
  name: string;
  callType: string;
  callOrder: number;
  recordingUrl?: string;
  summary: string;
}

interface SalesMotionDeal {
  id: string;
  name: string;
  dealOrder: number;
  calls: SalesMotionCallData[];
}

interface SalesMotionScript {
  id: string;
  callType: string;
  title: string;
  content: string;
  sourceCallCount: number;
  iterationHistory: Array<{
    feedback: string;
    createdAt: string;
  }>;
}

interface SalesMotionCollection {
  id: string;
  title: string;
  status: string;
  salesMotionSynthesis: string;
  scripts: SalesMotionScript[];
  deals: SalesMotionDeal[];
  createdAt: string;
  updatedAt: string;
  userId: string;
}

type TabId = "motion" | "deals" | string; // string for script-{id}

// ─── Wrapper with Suspense ──────────────────────────────────────────────────

export default function SalesMotionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600 dark:text-gray-300">Loading...</p>
          </div>
        </div>
      }
    >
      <SalesMotionContent />
    </Suspense>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ANALYZE_MESSAGES = [
  "Classifying your sales calls",
  "Identifying deal patterns",
  "Synthesizing your sales motion",
  "Generating call playbooks",
  "Finalizing analysis",
];

const CALL_TYPE_COLORS: Record<string, string> = {
  discovery: "bg-blue-100 text-blue-700",
  demo: "bg-purple-100 text-purple-700",
  proposal: "bg-green-100 text-green-700",
  negotiation: "bg-yellow-100 text-yellow-700",
  security: "bg-red-100 text-red-700",
  technical: "bg-indigo-100 text-indigo-700",
  closing: "bg-emerald-100 text-emerald-700",
  other: "bg-gray-100 text-gray-700 dark:text-gray-200",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSSE(
  buffer: string,
  onEvent: (event: string, data: unknown) => void
): string {
  const lines = buffer.split("\n");
  const remaining = lines.pop() || "";
  let currentEvent = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ") && currentEvent) {
      try {
        const data = JSON.parse(line.slice(6));
        onEvent(currentEvent, data);
      } catch {
        /* ignore parse errors */
      }
      currentEvent = "";
    }
  }
  return remaining;
}

// ─── Main Content ────────────────────────────────────────────────────────────

function SalesMotionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const collectionIdParam = searchParams.get("collectionId");
  const isAnalyzing = searchParams.get("analyzing") === "true";

  const [loading, setLoading] = useState(true);
  const [collection, setCollection] = useState<SalesMotionCollection | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("motion");

  // Overlay / streaming state
  const [showOverlay, setShowOverlay] = useState(isAnalyzing);
  const [streamingMotion, setStreamingMotion] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [scripts, setScripts] = useState<SalesMotionScript[]>([]);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  // Iterate state
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);
  const [iteratingStreamContent, setIteratingStreamContent] = useState("");

  // UI state
  const [deleting, setDeleting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());

  const analyzeStartedRef = useRef(false);

  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Sales Motion - Mikey";
  }, []);

  // ── Load collection data (view mode) ────────────────────────────────────

  useEffect(() => {
    if (isAnalyzing) {
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        let url = "/api/sales-motion/latest";
        if (collectionIdParam) {
          url = `/api/sales-motion/collections/${collectionIdParam}`;
        }

        const response = await fetch(url);
        if (!response.ok) return;

        const data = await response.json();

        if (collectionIdParam) {
          setCollection(data.collection);
          if (data.collection?.scripts) setScripts(data.collection.scripts);
        } else {
          if (data.hasCollection && data.collection) {
            setCollection(data.collection);
            if (data.collection.scripts) setScripts(data.collection.scripts);
          }
        }
      } catch (error) {
        console.error("Error loading sales motion collection:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, collectionIdParam, isAnalyzing]);

  // ── Handle analysis streaming ────────────────────────────────────────────

  useEffect(() => {
    if (!isAnalyzing || !collectionIdParam || analyzeStartedRef.current) return;
    analyzeStartedRef.current = true;

    async function streamAnalyze() {
      try {
        const response = await fetch("/api/sales-motion/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collectionIdParam }),
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          await showAlert({
            title: "Error",
            message: data.error || "Failed to start analysis.",
            variant: "danger",
          });
          router.push("/sales-motion/new");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          buffer = parseSSE(buffer, (event, data: unknown) => {
            const d = data as Record<string, unknown>;

            if (event === "classify_done") {
              setShowOverlay(false);
              setAnalysisProgress("Calls classified. Synthesizing sales motion...");
            } else if (event === "motion_token") {
              setStreamingMotion((prev) => prev + (d.token as string));
              setAnalysisProgress(null);
            } else if (event === "motion_done") {
              setAnalysisProgress("Generating call playbooks...");
            } else if (event === "script_done") {
              const script: SalesMotionScript = {
                id: d.id as string,
                callType: d.callType as string,
                title: d.title as string,
                content: d.content as string,
                sourceCallCount: d.sourceCallCount as number,
                iterationHistory: [],
              };
              setScripts((prev) => [...prev, script]);
            } else if (event === "complete") {
              setAnalysisComplete(true);
              setAnalysisProgress(null);
              const cId = d.collectionId as string;
              window.history.replaceState({}, "", `/sales-motion?collectionId=${cId}`);
              // Load the full collection
              fetch(`/api/sales-motion/collections/${cId}`)
                .then((res) => res.json())
                .then((cData) => {
                  if (cData.collection) {
                    setCollection(cData.collection);
                    if (cData.collection.scripts) setScripts(cData.collection.scripts);
                  }
                })
                .catch(console.error);
            } else if (event === "error") {
              showAlert({
                title: "Error",
                message: (d.message as string) || "Analysis failed.",
                variant: "danger",
              });
              router.push("/sales-motion/new");
            }
          });
        }
      } catch (error) {
        console.error("Stream error:", error);
        router.push("/sales-motion/new");
      }
    }

    streamAnalyze();
  }, [isAnalyzing, collectionIdParam, router, showAlert]);

  // ── Delete handler ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!collection) return;
    const confirmed = await showConfirm({
      title: "Delete Sales Motion",
      message: "Are you sure you want to delete this Sales Motion? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-motion/collections/${collection.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/sales-motion/new");
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
      }
    } catch {
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
    }
  };

  // ── Copy handler ────────────────────────────────────────────────────────

  const getActiveContent = useCallback((): string => {
    if (activeTab === "motion") {
      return collection?.salesMotionSynthesis || streamingMotion || "";
    }
    if (activeTab === "deals") return "";
    // Script tab
    const scriptId = activeTab.replace("script-", "");
    const script = scripts.find((s) => s.id === scriptId);
    return script?.content || "";
  }, [activeTab, collection, streamingMotion, scripts]);

  const handleCopy = async () => {
    const content = getActiveContent();
    if (!content) return;
    try {
      await copyMarkdownAsRichText(content);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      await navigator.clipboard.writeText(content);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // ── Iterate handler ─────────────────────────────────────────────────────

  const handleIterate = async () => {
    if (!collection || !iterateFeedback.trim()) return;
    setIterating(true);
    setIteratingStreamContent("");

    try {
      let url: string;
      let body: Record<string, string>;

      if (activeTab === "motion") {
        // Iterate on synthesis via PATCH on collection
        // We need a streaming iterate endpoint - use the same pattern as hiring profile
        // For motion, we PATCH the collection with new synthesis
        // But the spec says call PATCH on /api/sales-motion/collections/[id]
        // Since PATCH isn't streaming, we do a simple PATCH with feedback
        const res = await fetch(`/api/sales-motion/collections/${collection.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salesMotionSynthesis: iterateFeedback.trim(),
          }),
        });
        if (res.ok) {
          // Reload the collection
          const reloadRes = await fetch(`/api/sales-motion/collections/${collection.id}`);
          if (reloadRes.ok) {
            const data = await reloadRes.json();
            setCollection(data.collection);
          }
          setIterateFeedback("");
        } else {
          await showAlert({ title: "Error", message: "Failed to iterate.", variant: "danger" });
        }
        setIterating(false);
        return;
      }

      // Script tab - stream iterate
      const scriptId = activeTab.replace("script-", "");
      url = `/api/sales-motion/scripts/${scriptId}/iterate`;
      body = { feedback: iterateFeedback.trim() };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        await showAlert({ title: "Error", message: data.error || "Failed to iterate.", variant: "danger" });
        setIterating(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        buffer = parseSSE(buffer, (event, data: unknown) => {
          const d = data as Record<string, unknown>;
          if (event === "token") {
            setIteratingStreamContent((prev) => prev + (d.token as string));
          } else if (event === "complete") {
            // Update the script in our local state
            setScripts((prev) =>
              prev.map((s) =>
                s.id === scriptId
                  ? { ...s, content: "" } // will be replaced on reload
                  : s
              )
            );
            // Reload collection to get updated script
            fetch(`/api/sales-motion/collections/${collection.id}`)
              .then((res) => res.json())
              .then((cData) => {
                if (cData.collection) {
                  setCollection(cData.collection);
                  if (cData.collection.scripts) setScripts(cData.collection.scripts);
                }
              })
              .catch(console.error);
            setIteratingStreamContent("");
            setIterateFeedback("");
          } else if (event === "error") {
            showAlert({ title: "Error", message: (d.message as string) || "Iteration failed.", variant: "danger" });
          }
        });
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to iterate.", variant: "danger" });
      setIteratingStreamContent("");
    } finally {
      setIterating(false);
    }
  };

  // ── Deal accordion toggle ───────────────────────────────────────────────

  const toggleDeal = (dealId: string) => {
    setExpandedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  };

  // ── Formatting helper ───────────────────────────────────────────────────

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

  // ── Derived state ───────────────────────────────────────────────────────

  const isStreamingMode = isAnalyzing && !analysisComplete;
  const hasContent = !!collection || streamingMotion.length > 0 || scripts.length > 0;

  // Build tab list
  const tabs: Array<{ id: TabId; label: string }> = [{ id: "motion", label: "Motion Overview" }];
  for (const script of scripts) {
    tabs.push({ id: `script-${script.id}`, label: script.title });
  }
  tabs.push({ id: "deals", label: "Deals" });

  // Get the active script (if on a script tab)
  const activeScript =
    activeTab.startsWith("script-")
      ? scripts.find((s) => s.id === activeTab.replace("script-", ""))
      : null;

  // Content to display in the motion tab
  const motionContent =
    iterating && activeTab === "motion" && iteratingStreamContent
      ? iteratingStreamContent
      : isStreamingMode
        ? streamingMotion
        : collection?.salesMotionSynthesis || streamingMotion || "";

  // Content to display in a script tab
  const scriptContent =
    iterating && activeScript && iteratingStreamContent
      ? iteratingStreamContent
      : activeScript?.content || "";

  // Whether iterate sidebar should be disabled
  const iterateDisabled = isStreamingMode || activeTab === "deals";

  // ── Loading state ───────────────────────────────────────────────────────

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
            <p className="text-gray-600 dark:text-gray-300">Loading sales motion...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────

  if (!hasContent && !isAnalyzing) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">🔄</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">No Sales Motion Analysis Yet</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Analyze your sales calls to uncover your sales motion, deal patterns, and generate call playbooks.
            </p>
            <Link
              href="/sales-motion/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Analyze Sales Motion
            </Link>
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={showOverlay}
        title="Analyzing Your Sales Motion"
        subtitle="Classifying calls, identifying patterns, and synthesizing playbooks"
        emojis={["🔄", "📊", "✨"]}
        messages={ANALYZE_MESSAGES}
      />

      {/* Iterating overlay */}
      {iterating && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center max-w-sm">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-900 dark:text-gray-100 font-medium">Iterating...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Incorporating your feedback</p>
          </div>
        </div>
      )}

      {/* Header */}
      {!showOverlay && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Link
                  href="/chat"
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </Link>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {collection?.title || "Sales Motion"}
                  </h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {isStreamingMode ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {analysisProgress || "Analyzing..."}
                      </span>
                    ) : collection?.createdAt ? (
                      `Analyzed ${formatDate(collection.createdAt)}`
                    ) : (
                      ""
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ChatAboutButton
                  title="Chat About Sales Motion"
                  getContext={() => {
                    const parts: string[] = [];
                    if (collection?.salesMotionSynthesis) {
                      parts.push("## Sales Motion Overview\n\n" + collection.salesMotionSynthesis);
                    }
                    for (const s of scripts) {
                      parts.push(`## ${s.title}\n\n${s.content}`);
                    }
                    return parts.join("\n\n---\n\n");
                  }}
                />
                {activeTab !== "deals" && (
                  <button
                    onClick={handleCopy}
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                  >
                    {copiedField === "content" ? (
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                    {copiedField === "content" ? "Copied!" : "Copy"}
                  </button>
                )}
                {collection && (
                  <ShareDocumentButton
                    documentType="salesMotion"
                    documentId={collection.id}
                    title="Sales Motion"
                    content={collection.salesMotionSynthesis}
                  />
                )}
                {collection && (
                  <button
                    onClick={() => {
                      router.push(`/sales-motion?analyzing=true&collectionId=${collection.id}`);
                      window.location.reload();
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Re-analyze
                  </button>
                )}
                <Link
                  href="/sales-motion/new"
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  New Analysis
                </Link>
                <Link
                  href="/sales-motion/history"
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </Link>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {deleting ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      {!showOverlay && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex gap-8">
            {/* Left: Main content */}
            <div className="flex-1 min-w-0">
              {/* Tabs */}
              <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIterateFeedback("");
                      setIteratingStreamContent("");
                    }}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Motion Overview tab */}
              {activeTab === "motion" && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8">
                  {motionContent ? (
                    <div className="prose prose-gray max-w-none">
                      <ReactMarkdown>{motionContent}</ReactMarkdown>
                      {isStreamingMode && !analysisComplete && (
                        <span className="inline-block w-2 h-5 bg-purple-500 animate-pulse ml-0.5 align-text-bottom" />
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <p>Sales motion synthesis will appear here once analysis completes.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Script tabs */}
              {activeScript && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        CALL_TYPE_COLORS[activeScript.callType] || CALL_TYPE_COLORS.other
                      }`}
                    >
                      {activeScript.callType}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Based on {activeScript.sourceCallCount} call{activeScript.sourceCallCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <ReactMarkdown>{scriptContent}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Deals tab */}
              {activeTab === "deals" && (
                <div className="space-y-4">
                  {(collection?.deals || []).length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center text-gray-400">
                      <p>No deals available yet.</p>
                    </div>
                  ) : (
                    collection!.deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
                      >
                        {/* Deal header */}
                        <button
                          onClick={() => toggleDeal(deal.id)}
                          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <svg
                              className={`w-4 h-4 text-gray-400 transition-transform ${
                                expandedDeals.has(deal.id) ? "rotate-90" : ""
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <div className="text-left">
                              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                                {deal.name}
                              </h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {deal.calls.length} call{deal.calls.length !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>
                        </button>

                        {/* Expanded call list */}
                        {expandedDeals.has(deal.id) && (
                          <div className="border-t border-gray-100 divide-y divide-gray-100">
                            {deal.calls.map((call) => (
                              <div key={call.id} className="px-6 py-4 pl-14">
                                <div className="flex items-center gap-3 mb-1">
                                  <h4 className="font-medium text-gray-800 dark:text-gray-100 text-sm">
                                    {call.name}
                                  </h4>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                      CALL_TYPE_COLORS[call.callType] || CALL_TYPE_COLORS.other
                                    }`}
                                  >
                                    {call.callType}
                                  </span>
                                  {call.recordingUrl && (
                                    <a
                                      href={call.recordingUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      Recording
                                    </a>
                                  )}
                                </div>
                                {call.summary && (
                                  <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{call.summary}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Right: Sidebar */}
            <div className="hidden lg:block w-72 shrink-0">
              <div className="sticky top-8 space-y-4">
                <SidebarAdCards />

                {/* Iterate panel */}
                {hasContent && (
                  <div
                    className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm transition-opacity ${
                      iterateDisabled ? "opacity-50 pointer-events-none" : ""
                    }`}
                    title={
                      isStreamingMode
                        ? "Available once analysis is complete"
                        : activeTab === "deals"
                          ? "Switch to a content tab to iterate"
                          : undefined
                    }
                  >
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Iterate
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      {activeTab === "motion"
                        ? "Describe what to change in the sales motion overview."
                        : activeScript
                          ? `Describe what to change in the ${activeScript.title}.`
                          : "Select a content tab to iterate."}
                    </p>
                    <textarea
                      value={iterateFeedback}
                      onChange={(e) => setIterateFeedback(e.target.value)}
                      placeholder={
                        activeTab === "motion"
                          ? "e.g., Add more detail on the discovery stage, include metrics..."
                          : "e.g., Add more probing questions, adjust the objection handling..."
                      }
                      rows={5}
                      disabled={iterating || iterateDisabled}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y disabled:opacity-50 disabled:bg-gray-50"
                    />
                    <button
                      onClick={handleIterate}
                      disabled={iterating || iterateDisabled || !iterateFeedback.trim()}
                      className="mt-3 w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {iterating ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Iterating...
                        </>
                      ) : (
                        "Apply Changes"
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );
}
