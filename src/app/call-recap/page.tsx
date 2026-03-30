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

interface CallRecapVersion {
  id: string;
  title: string;
  callType: string;
  emailSubject: string;
  emailBody: string;
  recordingUrl: string;
  callSummary: string;
  callTranscript?: string;
  iterationHistory?: Array<{
    feedback: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user?: { name: string | null; email: string | null; slackUserName: string | null };
}

const CALL_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  discovery: { bg: "bg-blue-100", text: "text-blue-700" },
  demo: { bg: "bg-purple-100", text: "text-purple-700" },
  proposal: { bg: "bg-green-100", text: "text-green-700" },
  negotiation: { bg: "bg-orange-100", text: "text-orange-700" },
  closing: { bg: "bg-red-100", text: "text-red-700" },
  "follow-up": { bg: "bg-teal-100", text: "text-teal-700" },
  kickoff: { bg: "bg-indigo-100", text: "text-indigo-700" },
};

function getCallTypeColor(callType: string) {
  const lower = callType.toLowerCase();
  return CALL_TYPE_COLORS[lower] || { bg: "bg-gray-100", text: "text-gray-700" };
}

export default function CallRecapPage() {
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
      <CallRecapContent />
    </Suspense>
  );
}

const GENERATE_MESSAGES = [
  "Analyzing your call recording",
  "Extracting key discussion points",
  "Identifying action items",
  "Drafting your recap email",
  "Finalizing the email",
];

function CallRecapContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");
  const isGenerating = searchParams.get("generating") === "true";

  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState<CallRecapVersion | null>(null);
  const [showOverlay, setShowOverlay] = useState(isGenerating);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingSubject, setStreamingSubject] = useState("");
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<"email" | "source">("email");
  const [deleting, setDeleting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Iterate state
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);

  // Tone & Polish state
  const [toneGuidance, setToneGuidance] = useState("");
  const [toneSaving, setToneSaving] = useState(false);
  const [applyingTone, setApplyingTone] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [saving, setSaving] = useState(false);

  // Iteration history collapsed state
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const generateStartedRef = useRef(false);

  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Call Recap Email - Mikey";
  }, []);

  // Load tone guidance
  useEffect(() => {
    fetch("/api/call-recap/tone")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.value) setToneGuidance(data.value);
      })
      .catch(() => {});
  }, []);

  const saveToneGuidance = async () => {
    setToneSaving(true);
    try {
      await fetch("/api/call-recap/tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: toneGuidance.trim() }),
      });
    } catch { /* ignore */ }
    setToneSaving(false);
  };

  // Re-generate with updated tone (uses the original call data)
  const handleApplyTone = async () => {
    if (!version) return;
    // Save tone first
    await saveToneGuidance();
    setApplyingTone(true);
    setStreamingContent("");
    setStreamingComplete(false);

    try {
      const response = await fetch("/api/call-recap/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingUrl: version.recordingUrl,
          callSummary: version.callSummary,
          callTranscript: version.callTranscript || undefined,
          toneGuidance: toneGuidance.trim() || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        await showAlert({ title: "Error", message: "Failed to regenerate.", variant: "danger" });
        setApplyingTone(false);
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
                // Delete the old version, load the new one
                if (data.versionId) {
                  // Delete old version silently
                  await fetch(`/api/call-recap/versions/${version.id}`, { method: "DELETE" }).catch(() => {});
                  // Load new version
                  const res = await fetch(`/api/call-recap/versions/${data.versionId}`);
                  if (res.ok) {
                    const vData = await res.json();
                    setVersion(vData.version);
                    setStreamingContent("");
                    setStreamingComplete(true);
                    window.history.replaceState({}, "", `/call-recap?version=${data.versionId}`);
                  }
                }
              }
            } catch { /* ignore */ }
            currentEvent = "";
          }
        }
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to regenerate.", variant: "danger" });
      setStreamingContent("");
    } finally {
      setApplyingTone(false);
    }
  };

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

        let url = "/api/call-recap/latest";
        if (versionId) {
          url = `/api/call-recap/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
        } else {
          if (data.hasRecap) {
            setVersion(data.version);
          }
        }
      } catch (error) {
        console.error("Error loading call recap:", error);
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
        const stored = sessionStorage.getItem("callRecapInput");
        if (!stored) {
          await showAlert({ title: "Error", message: "No call recap input found. Please try again.", variant: "danger" });
          router.push("/call-recap/new");
          return;
        }

        const inputs = JSON.parse(stored);

        const response = await fetch("/api/call-recap/generate-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs),
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          await showAlert({ title: "Error", message: data.error || "Failed to generate call recap email.", variant: "danger" });
          router.push("/call-recap/new");
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
                  setShowOverlay(false);
                  setStreamingContent((prev) => prev + data.token);
                } else if (currentEvent === "complete") {
                  setStreamingComplete(true);
                  setStreamingSubject(data.emailSubject || "");
                  window.history.replaceState({}, "", `/call-recap?version=${data.versionId}`);
                  // Load the saved version
                  const res = await fetch(`/api/call-recap/versions/${data.versionId}`);
                  if (res.ok) {
                    const vData = await res.json();
                    setVersion(vData.version);
                  }
                } else if (currentEvent === "error") {
                  await showAlert({ title: "Error", message: data.message || "Generation failed.", variant: "danger" });
                  router.push("/call-recap/new");
                  return;
                }
              } catch { /* ignore parse errors */ }
              currentEvent = "";
            }
          }
        }
      } catch (error) {
        console.error("Stream error:", error);
        router.push("/call-recap/new");
      }
    }

    streamGenerate();
  }, [isGenerating, router, showAlert]);

  // Delete handler
  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete Call Recap Email",
      message: "Are you sure you want to delete this call recap email? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/call-recap/versions/${version.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          window.location.href = "/call-recap";
        } else {
          router.push("/call-recap/new");
        }
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete this recap email. Please try again.", variant: "danger" });
      }
    } catch (error) {
      console.error("Error deleting recap:", error);
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete this recap email. Please try again.", variant: "danger" });
    }
  };

  // Copy handler
  const handleCopy = async () => {
    if (!version) return;
    const fullContent = `Subject: ${version.emailSubject}\n\n${version.emailBody}`;
    try {
      await copyMarkdownAsRichText(fullContent);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      await navigator.clipboard.writeText(fullContent);
      setCopiedField("content");
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // Iterate handler
  const handleIterate = async () => {
    if (!version || !iterateFeedback.trim()) return;
    setIterating(true);
    setStreamingContent("");
    setStreamingComplete(false);

    try {
      const response = await fetch("/api/call-recap/iterate", {
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
                const res = await fetch(`/api/call-recap/versions/${data.versionId}`);
                if (res.ok) {
                  const vData = await res.json();
                  setVersion(vData.version);
                }
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
      setEditedSubject(version.emailSubject);
      setEditedBody(version.emailBody);
      setIsEditing(true);
    }
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditedSubject("");
    setEditedBody("");
  };

  const handleSave = async () => {
    if (!version) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/call-recap/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailSubject: editedSubject, emailBody: editedBody }),
      });
      if (res.ok) {
        const data = await res.json();
        setVersion(data.version);
        setIsEditing(false);
        setEditedSubject("");
        setEditedBody("");
      } else {
        await showAlert({ title: "Error", message: "Failed to save changes.", variant: "danger" });
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to save changes.", variant: "danger" });
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
            <p className="text-gray-600">Loading call recap email...</p>
          </div>
        </div>
      </div>
    );
  }

  const isStreamingMode = isGenerating && !streamingComplete;
  const hasStreamingContent = streamingContent.length > 0;
  const displayBody = (isStreamingMode || (iterating && streamingContent) || (applyingTone && streamingContent)) ? streamingContent : (isEditing ? editedBody : (version?.emailBody || ""));
  const displaySubject = isStreamingMode ? streamingSubject : (isEditing ? editedSubject : (version?.emailSubject || ""));

  // Empty state
  if (!version && !isGenerating && !hasStreamingContent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">✉️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">No Call Recap Emails Yet</h1>
            <p className="text-gray-600 mb-6">
              Generate a professional recap email from your sales call recording to keep prospects engaged and document next steps.
            </p>
            <Link
              href="/call-recap/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create Recap Email
            </Link>
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  const callTypeColor = version?.callType ? getCallTypeColor(version.callType) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={showOverlay}
        title="Generating Your Recap Email"
        subtitle="Analyzing your call to craft a professional follow-up email"
        emojis={["✉️", "📞", "✨"]}
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
            <p className="text-gray-900 font-medium">Iterating on your recap email...</p>
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
                  <h1 className="text-xl font-semibold text-gray-900">{version?.title || "Call Recap Email"}</h1>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {isStreamingMode ? (
                      <span className="flex items-center gap-2 text-sm text-gray-500">
                        <svg className="animate-spin h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </span>
                    ) : (
                      <>
                        {callTypeColor && version?.callType && (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${callTypeColor.bg} ${callTypeColor.text}`}>
                            {version.callType.charAt(0).toUpperCase() + version.callType.slice(1)}
                          </span>
                        )}
                        {version?.createdAt && (
                          <span className="text-sm text-gray-500">{formatDate(version.createdAt)}</span>
                        )}
                        {version?.user && (
                          <span className="text-sm text-gray-400">
                            by {version.user.name || version.user.slackUserName || version.user.email}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Recording link — first, most prominent */}
                {version?.recordingUrl && (
                  <a
                    href={version.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg transition-colors flex items-center gap-2 font-medium text-sm border border-purple-200"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Recording
                  </a>
                )}
                <ChatAboutButton
                  title="Chat About Call Recap Email"
                  getContext={() => {
                    return "## Call Recap Email\n\nSubject: " + (version?.emailSubject || "") + "\n\n" + (version?.emailBody || "");
                  }}
                />
                {version && (
                  <ShareDocumentButton
                    documentType="callRecap"
                    documentId={version.id}
                    title="Call Recap Email"
                    content={`Subject: ${version.emailSubject}\n\n${version.emailBody}`}
                  />
                )}
                <Link
                  href="/call-recap/history"
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </Link>
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
                <Link
                  href="/call-recap/new"
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium text-sm shadow-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  New Recap
                </Link>
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
              {!isStreamingMode && version && (
                <div className="flex gap-1 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => setActiveTab("email")}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "email"
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Recap Email
                  </button>
                  <button
                    onClick={() => setActiveTab("source")}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "source"
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Source Material
                  </button>
                </div>
              )}

              {/* Email content tab */}
              {(activeTab === "email" || isStreamingMode || !version) && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Subject line + Copy button row */}
                {!isEditing && displaySubject && (
                  <div className="bg-gray-50 border-b border-gray-200 px-8 py-4 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">
                      <span className="text-gray-500">Subject: </span>
                      {displaySubject}
                    </p>
                    <button
                      onClick={handleCopy}
                      className="flex-shrink-0 ml-4 px-3 py-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1.5 text-sm"
                    >
                      {copiedField === "content" ? (
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
                  </div>
                )}
                {isEditing ? (
                  <div className="bg-gray-50 border-b border-gray-200 px-8 py-4">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                    <input
                      type="text"
                      value={editedSubject}
                      onChange={(e) => setEditedSubject(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                ) : null}

                {/* Email body */}
                <div className="p-8">
                  {isEditing ? (
                    <textarea
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      className="w-full min-h-[600px] p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                    />
                  ) : (
                    <div className="prose prose-gray max-w-none">
                      <ReactMarkdown>{displayBody}</ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* View Recording link */}
                {!isEditing && version?.recordingUrl && (
                  <div className="border-t border-gray-200 px-8 py-4">
                    <a
                      href={version.recordingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      View Recording
                    </a>
                  </div>
                )}
              </div>
              )}

              {/* Source Material tab */}
              {activeTab === "source" && version && (
                <div className="space-y-6">
                  {/* Recording URL */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Call Recording</h3>
                    <a
                      href={version.recordingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-purple-600 hover:text-purple-800 font-medium text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {version.recordingUrl}
                    </a>
                  </div>

                  {/* Call Summary */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Call Summary</h3>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{version.callSummary}</div>
                  </div>

                  {/* Transcript */}
                  {version.callTranscript && (
                    <div className="bg-white border border-gray-200 rounded-xl p-6">
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Full Transcript</h3>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-[600px] overflow-y-auto">{version.callTranscript}</div>
                    </div>
                  )}
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
                {/* Call Coaching CTA */}
                {version && (
                  <button
                    onClick={() => {
                      try {
                        sessionStorage.setItem("callCoachingPrefill", JSON.stringify({
                          recordingUrl: version.recordingUrl,
                          transcript: version.callTranscript || version.callSummary,
                        }));
                      } catch { /* ignore */ }
                      window.open("/call-review", "_blank");
                    }}
                    className="block w-full text-left bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-5 text-white shadow-lg hover:shadow-xl transition-shadow"
                  >
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                    </div>
                    <h3 className="font-bold text-lg mb-1">Call Coaching</h3>
                    <p className="text-green-100 text-sm mb-4">
                      Grade this call with Mikey&apos;s call coaching scorecard and get actionable feedback.
                    </p>
                    <span className="block w-full text-center px-4 py-2.5 bg-white text-green-600 rounded-lg font-semibold text-sm">
                      Grade This Call
                    </span>
                  </button>
                )}

                {/* Iterate panel */}
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
                      Describe what to change and we&apos;ll revise the email.
                    </p>
                    <textarea
                      value={iterateFeedback}
                      onChange={(e) => setIterateFeedback(e.target.value)}
                      placeholder="e.g., Make the tone more casual, add a specific next step about scheduling a demo..."
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

                {/* Tone & Polish panel */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <h3 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Tone &amp; Polish
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Provide style guidance for all recap emails you generate.
                  </p>
                  <textarea
                    value={toneGuidance}
                    onChange={(e) => setToneGuidance(e.target.value)}
                    onBlur={saveToneGuidance}
                    placeholder='e.g., "Keep it concise — no fluff. Warm but professional tone. Always end with a specific next step and proposed date."'
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    {toneSaving ? "Saving..." : "Saves automatically. Applies to all future recaps."}
                  </p>
                  {version && (
                    <button
                      onClick={handleApplyTone}
                      disabled={applyingTone || iterating}
                      className="mt-3 w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {applyingTone ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Regenerating...
                        </>
                      ) : (
                        "Regenerate with Tone"
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );
}
