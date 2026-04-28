"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { NewButtonDropdown } from "@/components/NewButtonDropdown";
import { SidebarAdCards } from "@/components/SidebarAdCards";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";

interface NarrativeVersion {
  id: string;
  title: string;
  narrative: string;
  description1000w: string | null;
  description100w: string;
  description50w: string;
  description25w: string;
  sourceUrls: string[];
  sourcePdfNames: string[];
  createdAt: string;
  userId: string;
  user?: { name: string | null; email: string | null; slackUserName: string | null; };
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
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <SalesNarrativeContent />
    </Suspense>
  );
}

const GENERATE_MESSAGES = [
  "Crafting your story",
  "Distilling your value prop",
  "Synthesizing your narrative",
  "Building your pitch",
  "Refining the message",
];

function SalesNarrativeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");
  const isGenerating = searchParams.get("generating") === "true";

  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [version, setVersion] = useState<NarrativeVersion | null>(null);
  const [answersByCategory, setAnswersByCategory] = useState<AnswersByCategory | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Streaming generation state
  const [streamingNarrative, setStreamingNarrative] = useState("");
  const [streaming1000w, setStreaming1000w] = useState("");
  const [streaming100w, setStreaming100w] = useState("");
  const [streaming50w, setStreaming50w] = useState("");
  const [streaming25w, setStreaming25w] = useState("");
  const [showOverlay, setShowOverlay] = useState(isGenerating);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const streamStartedRef = useRef(false);

  // Tab state — read initial tab from URL hash (e.g. #1000w)
  const validTabs = ["qa", "narrative", "1000w", "100w", "50w", "25w"] as const;
  type Tab = typeof validTabs[number];
  const getTabFromHash = (): Tab => {
    if (typeof window === "undefined") return "narrative";
    const hash = window.location.hash.replace("#", "");
    return validTabs.includes(hash as Tab) ? (hash as Tab) : "narrative";
  };
  const [activeTab, setActiveTab] = useState<Tab>(isGenerating ? "narrative" : getTabFromHash);

  // Sync hash → tab on popstate (browser back/forward)
  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL hash when tab changes
  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.hash = tab;
    window.history.replaceState(null, "", url.toString());
  };

  // Next step banner
  const [showDiscoveryBanner, setShowDiscoveryBanner] = useState(true);
  const [hasDiscoveryQuestions, setHasDiscoveryQuestions] = useState(false);
  const [dqGenerating, setDqGenerating] = useState(false);
  const [dqDone, setDqDone] = useState(false);
  const dqGenerationTriggered = useRef(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editedNarrative, setEditedNarrative] = useState("");
  const [edited1000w, setEdited1000w] = useState("");
  const [edited100w, setEdited100w] = useState("");
  const [edited50w, setEdited50w] = useState("");
  const [edited25w, setEdited25w] = useState("");
  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();
  const [importing, setImporting] = useState(false);
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);
  const [iterationPrompt, setIterationPrompt] = useState<string | null>(null);

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

        if (data.currentUserId) {
          setCurrentUserId(data.currentUserId);
        }

        if (versionId) {
          setVersion(data.version);
          setAnswersByCategory(data.answersByCategory || null);
          initEditFields(data.version);
        } else {
          if (data.hasNarrative) {
            setVersion(data.version);
            setAnswersByCategory(data.answersByCategory || null);
            initEditFields(data.version);
            // Redirect to versioned URL so the browser URL is shareable/bookmarkable
            if (data.version?.id) {
              window.history.replaceState({}, "", `/sales-narrative?version=${data.version.id}`);
            }
          } else {
            // No narrative yet, redirect to edit
            router.push("/sales-narrative/edit");
            return;
          }
        }
        // Check if discovery questions already exist
        try {
          const dqRes = await fetch("/api/discovery-questions/latest");
          if (dqRes.ok) {
            const dqData = await dqRes.json();
            if (dqData.hasDiscoveryQuestions) setHasDiscoveryQuestions(true);
          }
        } catch {
          // Ignore
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    if (!isGenerating) {
      loadData();
    } else {
      // When generating, skip loading — we'll stream content directly
      setLoading(false);
    }
  }, [router, versionId, isGenerating]);

  // Streaming generation effect
  useEffect(() => {
    if (!isGenerating || streamStartedRef.current) return;
    streamStartedRef.current = true;

    let params = { sourceUrls: [] as string[], sourcePdfNames: [] as string[] };
    try {
      const stored = sessionStorage.getItem("narrativeGenerateParams");
      if (stored) {
        params = JSON.parse(stored);
        sessionStorage.removeItem("narrativeGenerateParams");
      }
    } catch { /* ignore */ }

    const startStream = async () => {
      try {
        const response = await fetch("/api/sales-narrative/generate-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok || !response.body) {
          console.error("Stream failed:", response.status);
          router.push("/sales-narrative/edit");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEvent === "narrative_token") {
                  // Hide overlay on first token
                  setShowOverlay(false);
                  setStreamingNarrative((prev) => prev + data.token);
                } else if (currentEvent === "condensed_done") {
                  setStreaming1000w(data.description1000w || "");
                } else if (currentEvent === "descriptions_done") {
                  setStreaming100w(data.description100w || "");
                  setStreaming50w(data.description50w || "");
                  setStreaming25w(data.description25w || "");
                } else if (currentEvent === "complete") {
                  setStreamingComplete(true);
                  // Update URL to point to the saved version
                  window.history.replaceState({}, "", `/sales-narrative?version=${data.versionId}`);
                  // Reload the version from DB to get full data
                  const res = await fetch(`/api/sales-narrative/versions/${data.versionId}`);
                  if (res.ok) {
                    const vData = await res.json();
                    setVersion(vData.version);
                    setAnswersByCategory(vData.answersByCategory || null);
                    setCurrentUserId(vData.currentUserId);
                  }
                } else if (currentEvent === "error") {
                  console.error("Stream error:", data.message);
                  router.push("/sales-narrative/edit");
                  return;
                }
              } catch { /* ignore parse errors */ }
              currentEvent = "";
            }
          }
        }
      } catch (error) {
        console.error("Stream error:", error);
        router.push("/sales-narrative/edit");
      }
    };

    startStream();
  }, [isGenerating, router]);

  // Auto-trigger Discovery Questions generation when narrative exists but DQ doesn't
  useEffect(() => {
    if (loading || !version || hasDiscoveryQuestions || dqGenerating || dqDone || dqGenerationTriggered.current) return;
    dqGenerationTriggered.current = true;
    setDqGenerating(true);
    // Signal to Discovery Questions page that generation is in progress
    localStorage.setItem("dqGeneratingStarted", Date.now().toString());
    fetch("/api/discovery-questions/generate", { method: "POST" })
      .then(async (res) => {
        if (res.ok) {
          setDqDone(true);
          setHasDiscoveryQuestions(true);
          localStorage.removeItem("dqGeneratingStarted");
        }
      })
      .catch(() => {
        // Silently fail — user can still trigger manually
        localStorage.removeItem("dqGeneratingStarted");
      })
      .finally(() => {
        setDqGenerating(false);
      });
  }, [loading, version, hasDiscoveryQuestions, dqGenerating, dqDone]);

  const initEditFields = (v: NarrativeVersion) => {
    setEditTitle(v.title || "");
    setEditedNarrative(v.narrative);
    setEdited1000w(v.description1000w || "");
    setEdited100w(v.description100w);
    setEdited50w(v.description50w);
    setEdited25w(v.description25w);
  };

  const handleCopy = async (text: string, field: string) => {
    const success = await copyMarkdownAsRichText(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleClone = async () => {
    if (!version) return;
    try {
      const res = await fetch("/api/documents/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: "salesNarrative", documentId: version.id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Error cloning:", error);
    }
  };

  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete Sales Narrative",
      message: "Are you sure you want to delete this Sales Narrative? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-narrative/versions/${version.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          // Load the next most recent version
          window.location.href = "/sales-narrative";
        } else {
          // No versions left, go to edit page to create new
          router.push("/sales-narrative/edit");
        }
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete this narrative. Please try again.", variant: "danger" });
      }
    } catch (error) {
      console.error("Error deleting narrative:", error);
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete this narrative. Please try again.", variant: "danger" });
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
          title: editTitle,
          narrative: editedNarrative,
          description1000w: edited1000w || null,
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
      await showAlert({
        title: "Error",
        message: "Failed to save changes. Please try again.",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleImportPDF = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("appletType", "salesNarrative");
      const response = await fetch("/api/import", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import PDF", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      initEditFields(data.version);
    } catch (error) {
      console.error("Error importing PDF:", error);
      await showAlert({ title: "Error", message: "Failed to import PDF. Please try again.", variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  // Iterate handler — creates a new version based on feedback
  const handleIterate = async () => {
    if (!version || !iterateFeedback.trim()) return;
    setIterating(true);
    try {
      const response = await fetch("/api/sales-narrative/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id, feedback: iterateFeedback.trim() }),
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
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "complete") {
                setVersion({
                  ...version,
                  id: data.versionId,
                  title: data.title,
                  narrative: data.narrative,
                  description100w: data.description100w,
                  description50w: data.description50w,
                  description25w: data.description25w,
                });
                setIterateFeedback("");
                setIterationPrompt(data.iterationPrompt);
                window.history.replaceState({}, "", `/sales-narrative?version=${data.versionId}`);
              } else if (currentEvent === "error") {
                await showAlert({ title: "Error", message: data.message || "Iteration failed", variant: "danger" });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (error) {
      console.error("Error iterating:", error);
      await showAlert({ title: "Error", message: "Failed to iterate. Please try again.", variant: "danger" });
    } finally {
      setIterating(false);
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
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600 dark:text-gray-300">Loading narrative...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show streaming UI when generating (even without a version yet)
  const isStreamingMode = isGenerating && !streamingComplete;
  const hasStreamingContent = streamingNarrative.length > 0;

  if (!version && !isGenerating && !hasStreamingContent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📝</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">No Narrative Yet</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
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
      </div>
    );
  }

  // Get current content (streaming → edited → version)
  const currentNarrative = isStreamingMode ? streamingNarrative : (isEditing ? editedNarrative : (version?.narrative || ""));
  const current1000w = isStreamingMode ? streaming1000w : (isEditing ? edited1000w : (version?.description1000w || ""));
  const current100w = isStreamingMode ? streaming100w : (isEditing ? edited100w : (version?.description100w || ""));
  const current50w = isStreamingMode ? streaming50w : (isEditing ? edited50w : (version?.description50w || ""));
  const current25w = isStreamingMode ? streaming25w : (isEditing ? edited25w : (version?.description25w || ""));

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={showOverlay}
        title="Generating Your Sales Narrative"
        subtitle="Creating your narrative, value propositions, and tagline"
        emojis={["✍️", "📝", "✨"]}
        messages={GENERATE_MESSAGES}
      />
      {/* Header */}
      {!showOverlay && <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
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
                {isStreamingMode && !version ? (
                  <>
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Sales Narrative</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                      <svg className="animate-spin h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </p>
                  </>
                ) : isEditing ? (
                  <textarea
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Sales Narrative"
                    rows={1}
                    className="text-xl font-semibold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize"
                    style={{ minHeight: "2.5rem" }}
                  />
                ) : (
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{version?.title || "Sales Narrative"}</h1>
                )}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {version?.createdAt ? `Generated ${formatDate(version.createdAt)}` : ""}
                  {version?.user && <span className="text-sm text-gray-400 ml-2">by {version.user.name || version.user.slackUserName || version.user.email}</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isStreamingMode ? (
                <span className="text-sm text-purple-600 font-medium flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </span>
              ) : isEditing ? (
                <>
                  <button
                    onClick={handleCancelEditing}
                    disabled={saving}
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
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
                  <ChatAboutButton
                    title="Chat About Sales Narrative"
                    getContext={() => {
                      let context = "";
                      if (answersByCategory) {
                        context += "## Q&A Answers\n\n";
                        for (const [category, answers] of Object.entries(answersByCategory)) {
                          context += `### ${category}\n\n`;
                          for (const qa of answers) {
                            context += `Q${qa.globalOrder}: ${qa.question}\nA: ${qa.answer || "(Not answered)"}\n\n`;
                          }
                        }
                      }
                      context += "## Full Narrative\n\n" + (version?.narrative || "") + "\n\n";
                      if (version?.description1000w) {
                        context += "## 1000-Word Narrative\n\n" + version.description1000w + "\n\n";
                      }
                      context += "## 100-Word Description\n\n" + (version?.description100w || "") + "\n\n";
                      context += "## 50-Word Description\n\n" + (version?.description50w || "") + "\n\n";
                      context += "## 25-Word Description\n\n" + (version?.description25w || "") + "\n";
                      return context;
                    }}
                  />
                  {version && <ShareDocumentButton
                    documentType="salesNarrative"
                    documentId={version.id}
                    title={version.title || "Sales Narrative"}
                    content={JSON.stringify({
                      narrative: currentNarrative,
                      description1000w: current1000w || "",
                      description100w: current100w,
                      description50w: current50w,
                      description25w: current25w,
                      answersByCategory: answersByCategory || null,
                    })}
                  />}
                  {version?.userId === currentUserId && (
                    <button
                      onClick={handleStartEditing}
                      className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </button>
                  )}
                  <Link
                    href="/sales-narrative/history"
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </Link>
                  {version?.userId === currentUserId && (
                    <button
                      onClick={handleClone}
                      className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Clone
                    </button>
                  )}
                  {version?.userId === currentUserId && (
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
                  )}
                  <NewButtonDropdown
                    onRegenerate={() => router.push("/sales-narrative/edit")}
                    onUploadPDF={handleImportPDF}
                    importing={importing}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>}

      {/* Main Content */}
      {!showOverlay && <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Dismissable Next Step Banner - Discovery Questions generation status */}
        {!isStreamingMode && showDiscoveryBanner && !isEditing && (dqGenerating || dqDone || !hasDiscoveryQuestions) && (
          <div className="mb-6 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                {dqGenerating ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <p className="font-medium">
                {dqGenerating ? (
                  <>
                    Generating your{" "}
                    <Link href="/discovery-questions" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                      Discovery Questions
                    </Link>{" "}
                    from your Sales Narrative...
                  </>
                ) : dqDone ? (
                  <>
                    Your{" "}
                    <Link href="/discovery-questions" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                      Discovery Questions
                    </Link>{" "}
                    are ready! Done!
                  </>
                ) : (
                  <>
                    Congrats on finishing your Sales Narrative! Now let&apos;s use this to{" "}
                    <Link href="/discovery-questions" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                      create your discovery questions
                    </Link>.
                  </>
                )}
              </p>
            </div>
            <button
              onClick={() => setShowDiscoveryBanner(false)}
              className="flex-shrink-0 ml-4 p-1 hover:bg-white/20 rounded-full transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Sources Used */}
        {version && (version.sourceUrls?.length > 0 || version.sourcePdfNames?.length > 0) && (
          <div className="mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Sources Used
            </h3>
            {version.sourceUrls?.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Website Pages</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                  {[...version.sourceUrls].sort((a, b) => {
                    try {
                      const pathA = new URL(a).pathname.toLowerCase();
                      const pathB = new URL(b).pathname.toLowerCase();
                      return pathA.localeCompare(pathB);
                    } catch { return a.localeCompare(b); }
                  }).map((url, i) => {
                    let displayPath = "/";
                    try {
                      const parsed = new URL(url);
                      displayPath = parsed.pathname === "/" ? parsed.host : parsed.pathname.replace(/\/+$/, "");
                    } catch {
                      displayPath = url;
                    }
                    return (
                      <li key={i} className="text-sm text-blue-600 truncate">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={url}>
                          {displayPath}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {version.sourcePdfNames?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">PDF Files</p>
                <ul className="space-y-1">
                  {version.sourcePdfNames.map((name, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-8">
        {/* Left: Main content */}
        <div className="flex-1 min-w-0">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => switchTab("qa")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "qa"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Q&A Inputs
          </button>
          <button
            onClick={() => switchTab("narrative")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "narrative"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Full Narrative
          </button>
          {current1000w && (
            <button
              onClick={() => switchTab("1000w")}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                activeTab === "1000w"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              1000 Words
            </button>
          )}
          <button
            onClick={() => switchTab("100w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "100w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            100 Words
          </button>
          <button
            onClick={() => switchTab("50w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "50w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            50 Words
          </button>
          <button
            onClick={() => switchTab("25w")}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === "25w"
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            25 Words
          </button>
        </div>

        {/* Content */}
        {activeTab === "qa" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Questionnaire Answers</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
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

                  const colors = categoryColors[category] || { bg: "bg-gray-50", border: "border-gray-200 dark:border-gray-700", text: "text-gray-700 dark:text-gray-200" };

                  return (
                    <div key={category} className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
                      <h3 className={`font-semibold ${colors.text} mb-3`}>{category}</h3>
                      <div className="space-y-4">
                        {answers.map((qa) => (
                          <div key={qa.questionId} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-100">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                              Q{qa.globalOrder}: {qa.question}
                            </p>
                            <p className="text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
                              {qa.answer || <span className="text-gray-400 italic">Not answered</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No questionnaire data available for this version.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "narrative" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Full Sales Narrative</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getWordCount(currentNarrative)} words - Complete version
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(currentNarrative, "narrative")}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
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
                  className="w-full min-h-[400px] p-4 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100 font-normal"
                />
              ) : (
                <div className="prose prose-gray max-w-none">
                  <ReactMarkdown>{currentNarrative}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "1000w" && current1000w && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">1000-Word Narrative</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getWordCount(current1000w)} words - Condensed version
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current1000w, "1000w")}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedField === "1000w" ? (
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
                  value={edited1000w}
                  onChange={(e) => setEdited1000w(e.target.value)}
                  className="w-full min-h-[300px] p-4 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100 font-normal"
                />
              ) : (
                <div className="prose prose-gray max-w-none">
                  <ReactMarkdown>{current1000w}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "100w" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">100-Word Description</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getWordCount(current100w)} words - Product marketing summary
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current100w, "100w")}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
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
                  className="w-full min-h-[150px] p-4 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100"
                />
              ) : (
                <div className="prose prose-lg prose-gray max-w-none">
                  <ReactMarkdown>{current100w}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "50w" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">50-Word Elevator Pitch</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getWordCount(current50w)} words - ~20 second spoken pitch
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current50w, "50w")}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
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
                  className="w-full min-h-[100px] p-4 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100"
                />
              ) : (
                <div className="prose prose-xl prose-gray max-w-none">
                  <ReactMarkdown>{current50w}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "25w" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">25-Word Tagline</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getWordCount(current25w)} words - One-liner
                </p>
              </div>
              {!isEditing && (
                <button
                  onClick={() => handleCopy(current25w, "25w")}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
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
                  className="w-full min-h-[80px] p-4 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800 dark:text-gray-100"
                />
              ) : (
                <div className="prose prose-2xl prose-gray max-w-none font-medium">
                  <ReactMarkdown>{current25w}</ReactMarkdown>
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
              <p className="text-sm text-gray-700 dark:text-gray-200">{current100w}</p>
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
              <p className="text-sm text-gray-700 dark:text-gray-200">{current50w}</p>
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
              <p className="text-sm text-gray-700 dark:text-gray-200">{current25w}</p>
            </div>
          </div>
        )}

        </div>{/* end main content */}

        {/* Right sidebar: Iterate widget + Next step CTA */}
        {!isEditing && (
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="sticky top-8 space-y-4">
              {/* Iterate widget */}
              {version && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Iterate on Narrative</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Describe what you&apos;d like to change and we&apos;ll create a new version.
                  </p>
                  {iterationPrompt && (
                    <div className="mb-3 bg-purple-50 rounded-lg p-2.5">
                      <p className="text-xs text-purple-600 font-medium mb-0.5">Last iteration:</p>
                      <p className="text-xs text-purple-700">{iterationPrompt}</p>
                    </div>
                  )}
                  <textarea
                    value={iterateFeedback}
                    onChange={(e) => setIterateFeedback(e.target.value)}
                    disabled={iterating}
                    placeholder='e.g. "Make the problem statement more urgent" or "Add more about our competitive advantage"'
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y disabled:opacity-50"
                  />
                  <button
                    onClick={handleIterate}
                    disabled={iterating || !iterateFeedback.trim()}
                    className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-sm shadow-md"
                  >
                    {iterating ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Iterating...
                      </>
                    ) : (
                      "Iterate"
                    )}
                  </button>
                </div>
              )}

              {(dqGenerating || dqDone || !hasDiscoveryQuestions) && (
              <div className="bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl p-5 text-white shadow-lg">
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                  {dqGenerating ? (
                    <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                {dqGenerating ? (
                  <>
                    <h3 className="font-bold text-lg mb-2">Discovery Questions</h3>
                    <p className="text-purple-100 text-sm mb-4">
                      Generating your Discovery Questions from your Sales Narrative...
                    </p>
                    <Link
                      href="/discovery-questions"
                      target="_blank"
                      className="block w-full text-center px-4 py-2.5 bg-white/20 text-white rounded-lg font-semibold text-sm cursor-pointer hover:bg-white/30 transition-colors"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </span>
                    </Link>
                  </>
                ) : dqDone ? (
                  <>
                    <h3 className="font-bold text-lg mb-2">Discovery Questions</h3>
                    <p className="text-purple-100 text-sm mb-4">
                      Your Discovery Questions have been generated from your Sales Narrative!
                    </p>
                    <Link
                      href="/discovery-questions"
                      target="_blank"
                      className="block w-full text-center px-4 py-2.5 bg-white dark:bg-gray-800 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
                    >
                      Done! View Questions
                    </Link>
                  </>
                ) : (
                  <>
                    <h3 className="font-bold text-lg mb-2">Discovery Questions</h3>
                    <p className="text-purple-100 text-sm mb-4">
                      Turn your sales narrative into powerful discovery questions that uncover buyer pain points.
                    </p>
                    <Link
                      href="/discovery-questions"
                      target="_blank"
                      className="block w-full text-center px-4 py-2.5 bg-white dark:bg-gray-800 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
                    >
                      Create Questions
                    </Link>
                  </>
                )}
              </div>
              )}

              <SidebarAdCards />
            </div>
          </div>
        )}
        </div>{/* end flex row */}
      </div>}
      {ConfirmModalElement}
    </div>
  );
}
