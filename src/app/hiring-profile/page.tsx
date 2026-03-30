"use client";

import { useState, useEffect, useRef, Suspense } from "react";
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

interface HiringProfileVersion {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  userId: string;
  iterationHistory?: string[];
  user?: { name: string | null; email: string | null; slackUserName: string | null };
}

export default function HiringProfilePage() {
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
      <HiringProfileContent />
    </Suspense>
  );
}

const GENERATE_MESSAGES = [
  "Analyzing your sales motion",
  "Building the ideal AE profile",
  "Defining must-have competencies",
  "Crafting interview criteria",
  "Finalizing your hiring profile",
];

function HiringProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");
  const isGenerating = searchParams.get("generating") === "true";

  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState<HiringProfileVersion | null>(null);
  const [answersByCategory, setAnswersByCategory] = useState<Record<string, Array<{ questionId: string; globalOrder: number; question: string; answer: string }>> | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "qa">("profile");
  const [showOverlay, setShowOverlay] = useState(isGenerating);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Iterate state
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Regenerate state
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenerateGuidance, setRegenerateGuidance] = useState("");

  // Iteration history collapsed state
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const generateStartedRef = useRef(false);

  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "AE Hiring Profile - Mikey";
  }, []);

  // Load data
  useEffect(() => {
    if (isGenerating) {
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

        let url = "/api/hiring-profile/latest";
        if (versionId) {
          url = `/api/hiring-profile/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          // No profile exists
          return;
        }

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          if (data.answersByCategory) setAnswersByCategory(data.answersByCategory);
        } else {
          if (data.hasProfile) {
            setVersion(data.version);
            if (data.answersByCategory) setAnswersByCategory(data.answersByCategory);
          }
        }
      } catch (error) {
        console.error("Error loading hiring profile:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, versionId, isGenerating]);

  // Handle streaming generation flow
  useEffect(() => {
    if (!isGenerating || generateStartedRef.current) return;
    generateStartedRef.current = true;

    async function streamGenerate() {
      try {
        // Check for guidance from regenerate modal or first-time creation
        let guidance = "";
        try {
          const stored = sessionStorage.getItem("hiringProfileGuidance");
          if (stored) {
            guidance = stored;
            sessionStorage.removeItem("hiringProfileGuidance");
          }
        } catch { /* ignore */ }

        const response = await fetch("/api/hiring-profile/generate-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guidance: guidance || undefined }),
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          await showAlert({ title: "Error", message: data.error || "Failed to generate hiring profile.", variant: "danger" });
          router.push("/hiring-profile/edit");
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

                if (currentEvent === "token") {
                  // Hide overlay on first token
                  setShowOverlay(false);
                  setStreamingContent((prev) => prev + data.token);
                } else if (currentEvent === "complete") {
                  setStreamingComplete(true);
                  window.history.replaceState({}, "", `/hiring-profile?version=${data.versionId}`);
                  // Load the saved version
                  const res = await fetch(`/api/hiring-profile/versions/${data.versionId}`);
                  if (res.ok) {
                    const vData = await res.json();
                    setVersion(vData.version);
                    if (vData.answersByCategory) setAnswersByCategory(vData.answersByCategory);
                  }
                } else if (currentEvent === "error") {
                  await showAlert({ title: "Error", message: data.message || "Generation failed.", variant: "danger" });
                  router.push("/hiring-profile/edit");
                  return;
                }
              } catch { /* ignore parse errors */ }
              currentEvent = "";
            }
          }
        }
      } catch (error) {
        console.error("Stream error:", error);
        router.push("/hiring-profile/edit");
      }
    }

    streamGenerate();
  }, [isGenerating, router, showAlert]);

  // Delete handler
  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete AE Hiring Profile",
      message: "Are you sure you want to delete this AE Hiring Profile? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hiring-profile/versions/${version.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          window.location.href = "/hiring-profile";
        } else {
          router.push("/hiring-profile/edit");
        }
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete this profile. Please try again.", variant: "danger" });
      }
    } catch (error) {
      console.error("Error deleting profile:", error);
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete this profile. Please try again.", variant: "danger" });
    }
  };

  // Copy handler
  const handleCopy = async () => {
    if (!version) return;
    try {
      await copyMarkdownAsRichText(version.content);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback to plain text
      await navigator.clipboard.writeText(version.content);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // Iterate handler
  const handleIterate = async () => {
    if (!version || !iterateFeedback.trim()) return;
    setIterating(true);
    // Clear content to show streaming
    setStreamingContent("");
    setStreamingComplete(false);

    try {
      const response = await fetch("/api/hiring-profile/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: version.id,
          feedback: iterateFeedback.trim(),
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        await showAlert({ title: "Error", message: data.error || "Failed to iterate.", variant: "danger" });
        setStreamingContent("");
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
              if (currentEvent === "token") {
                setStreamingContent((prev) => prev + data.token);
              } else if (currentEvent === "complete") {
                // Reload the new version (iterate creates a new version)
                const res = await fetch(`/api/hiring-profile/versions/${data.versionId}`);
                if (res.ok) {
                  const vData = await res.json();
                  setVersion(vData.version);
                  if (vData.answersByCategory) setAnswersByCategory(vData.answersByCategory);
                }
                window.history.replaceState({}, "", `/hiring-profile?version=${data.versionId}`);
                setStreamingContent("");
                setStreamingComplete(true);
                setIterateFeedback("");
              } else if (currentEvent === "error") {
                await showAlert({ title: "Error", message: data.message || "Iteration failed.", variant: "danger" });
              }
            } catch { /* ignore parse errors */ }
            currentEvent = "";
          }
        }
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to iterate.", variant: "danger" });
      setStreamingContent("");
    } finally {
      setIterating(false);
    }
  };

  // Edit handlers
  const handleStartEditing = () => {
    if (version) {
      setEditedContent(version.content);
      setIsEditing(true);
    }
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditedContent("");
  };

  const handleSave = async () => {
    if (!version) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hiring-profile/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setVersion(data.version);
        setIsEditing(false);
        setEditedContent("");
      } else {
        await showAlert({ title: "Error", message: "Failed to save changes.", variant: "danger" });
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to save changes.", variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  // Regenerate handler — creates a brand new profile with optional guidance
  const handleRegenerate = () => {
    try {
      if (regenerateGuidance.trim()) {
        sessionStorage.setItem("hiringProfileGuidance", regenerateGuidance.trim());
      }
    } catch { /* ignore */ }
    setShowRegenerate(false);
    router.push("/hiring-profile?generating=true");
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

  // Loading state
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
            <p className="text-gray-600">Loading hiring profile...</p>
          </div>
        </div>
      </div>
    );
  }

  const isStreamingMode = isGenerating && !streamingComplete;
  const hasStreamingContent = streamingContent.length > 0;
  const displayContent = (isStreamingMode || (iterating && streamingContent)) ? streamingContent : (isEditing ? editedContent : (version?.content || ""));

  // Empty state — no profile exists
  if (!version && !isGenerating && !hasStreamingContent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">👤</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">No AE Hiring Profile Yet</h1>
            <p className="text-gray-600 mb-6">
              Generate an ideal AE hiring profile based on your sales narrative and discovery process to find the right sales talent.
            </p>
            <Link
              href="/hiring-profile/edit"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create Hiring Profile
            </Link>
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={showOverlay}
        title="Generating Your AE Hiring Profile"
        subtitle="Analyzing your sales motion to define the ideal AE profile"
        emojis={["👤", "🎯", "✨"]}
        messages={GENERATE_MESSAGES}
      />

      {/* Iterating overlay */}
      {iterating && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-sm">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-900 font-medium">Iterating on your profile...</p>
            <p className="text-sm text-gray-500 mt-1">Incorporating your feedback</p>
          </div>
        </div>
      )}

      {/* Header */}
      {!showOverlay && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Link
                  href="/chat"
                  className="text-gray-500 hover:text-gray-700 flex items-center gap-1 shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </Link>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-semibold text-gray-900">{version?.title || "AE Hiring Profile"}</h1>
                  <p className="text-sm text-gray-500">
                    {isStreamingMode ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </span>
                    ) : version?.createdAt ? `Generated ${formatDate(version.createdAt)}` : ""}
                    {version?.user && (
                      <span className="text-sm text-gray-400 ml-2">
                        by {version.user.name || version.user.slackUserName || version.user.email}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ChatAboutButton
                  title="Chat About AE Hiring Profile"
                  getContext={() => {
                    return "## AE Hiring Profile\n\n" + (version?.content || "");
                  }}
                />
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
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
                {version && (
                  <ShareDocumentButton
                    documentType="hiringProfile"
                    documentId={version.id}
                    title="AE Hiring Profile"
                    content={version.content}
                  />
                )}
                <Link
                  href="/hiring-profile/history"
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </Link>
                <button
                  onClick={() => setShowRegenerate(true)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate
                </button>
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
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
                    >
                      {saving ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Saving...
                        </>
                      ) : "Save"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStartEditing}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                )}
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

      {/* Main Content */}
      {!showOverlay && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex gap-8">
            {/* Left: Main content */}
            <div className="flex-1 min-w-0">
              {/* Tabs */}
              {!isStreamingMode && (
                <div className="flex gap-1 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => setActiveTab("profile")}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "profile"
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Profile
                  </button>
                  {answersByCategory && Object.keys(answersByCategory).length > 0 && (
                    <button
                      onClick={() => setActiveTab("qa")}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === "qa"
                          ? "border-purple-600 text-purple-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      Q&A Inputs
                    </button>
                  )}
                </div>
              )}

              {/* Profile content */}
              {(activeTab === "profile" || isStreamingMode) && (
              <>
              {/* Iteration prompt banner */}
              {version?.iterationHistory && version.iterationHistory.length > 0 && !isEditing && (
                <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                  <p className="text-xs font-medium text-purple-700 mb-1">Latest iteration prompt:</p>
                  <p className="text-sm text-purple-900">&ldquo;{version.iterationHistory[version.iterationHistory.length - 1]}&rdquo;</p>
                </div>
              )}
              <div className="bg-white border border-gray-200 rounded-xl p-8">
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full min-h-[600px] p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                  />
                ) : (
                  <div className="prose prose-gray max-w-none">
                    <ReactMarkdown>{displayContent}</ReactMarkdown>
                  </div>
                )}
              </div>
              </>
              )}

              {/* Q&A Inputs tab */}
              {activeTab === "qa" && answersByCategory && (
                <div className="space-y-6">
                  {Object.entries(answersByCategory).map(([category, answers]) => (
                    <div key={category} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                        <h3 className="font-semibold text-gray-900">{category}</h3>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {(answers as Array<{ questionId: string; globalOrder: number; question: string; answer: string }>).map((qa) => (
                          <div key={qa.questionId} className="px-6 py-4">
                            <p className="text-sm font-medium text-gray-700 mb-1">
                              Q{qa.globalOrder}: {qa.question}
                            </p>
                            <p className="text-sm text-gray-600">
                              {qa.answer || <span className="text-gray-400 italic">Not answered</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Iteration History */}
              {version?.iterationHistory && version.iterationHistory.length > 0 && (
                <div className="mt-8">
                  <button
                    onClick={() => setHistoryExpanded(!historyExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${historyExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Iteration History ({version.iterationHistory.length})
                  </button>
                  {historyExpanded && (
                    <div className="mt-3 space-y-3">
                      {version.iterationHistory.map((item, index) => (
                        <div
                          key={index}
                          className="bg-white border border-gray-200 rounded-lg p-4"
                        >
                          <p className="text-sm text-gray-700">{item.feedback}</p>
                          <p className="text-xs text-gray-400 mt-2">{formatDate(item.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Sidebar */}
            <div className="hidden lg:block w-72 shrink-0">
              <div className="sticky top-8 space-y-4">
                <SidebarAdCards />

                {/* Iterate panel — sticky, follows the user */}
                {(version || hasStreamingContent) && (
                  <div
                    className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm transition-opacity ${isStreamingMode ? "opacity-50 pointer-events-none" : ""}`}
                    title={isStreamingMode ? "Available once generation is complete" : undefined}
                  >
                    <h3 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Iterate
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Describe what to change and we&apos;ll revise the profile.
                    </p>
                    <textarea
                      value={iterateFeedback}
                      onChange={(e) => setIterateFeedback(e.target.value)}
                      placeholder="e.g., Put more emphasis on outbound prospecting skills, adjust the comp range to $120-150K OTE..."
                      rows={5}
                      disabled={iterating || isStreamingMode}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y disabled:opacity-50 disabled:bg-gray-50"
                    />
                    <button
                      onClick={handleIterate}
                      disabled={iterating || isStreamingMode || !iterateFeedback.trim()}
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

      {/* Regenerate Modal */}
      {showRegenerate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRegenerate(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Regenerate AE Hiring Profile</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will generate a brand new profile from your current Q&amp;A answers. Optionally provide guidance to steer the generation.
            </p>
            <textarea
              value={regenerateGuidance}
              onChange={e => setRegenerateGuidance(e.target.value)}
              placeholder='Optional: e.g., "Focus more on outbound hunting skills" or "Target $50-100K ACV enterprise motion"'
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
              <button
                onClick={() => setShowRegenerate(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors font-medium"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );
}
