"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { NewButtonDropdown } from "@/components/NewButtonDropdown";

// Dynamically import RichTextEditor to avoid SSR issues
const RichTextEditor = dynamic(
  () => import("@/components/RichTextEditor"),
  { ssr: false }
);

interface FirstCallChecklistVersion {
  id: string;
  title: string;
  content: string;
  discoveryQuestionsVersionId: string;
  discoveryQuestionsVersion?: {
    id: string;
    createdAt: string;
    salesNarrativeVersion?: {
      id: string;
      createdAt: string;
    };
  };
  createdAt: string;
  updatedAt: string;
  userId: string;
  user?: { name: string | null; email: string | null; slackUserName: string | null; };
}

export default function FirstCallChecklistPage() {
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
      <FirstCallChecklistContent />
    </Suspense>
  );
}

function FirstCallChecklistContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [version, setVersion] = useState<FirstCallChecklistVersion | null>(null);
  const [hasDiscoveryQuestions, setHasDiscoveryQuestions] = useState(false);
  const [hasPreCallPlanning, setHasPreCallPlanning] = useState(false);
  const [showPreCallBanner, setShowPreCallBanner] = useState(true);
  const [copied, setCopied] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);
  const [iterationPrompt, setIterationPrompt] = useState<string | null>(null);
  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();
  const autoGenerateRef = useRef(searchParams.get("auto") === "true");

  useEffect(() => {
    document.title = "First Call Checklist - Mikey";
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

        let url = "/api/first-call-checklist/latest";
        if (versionId) {
          url = `/api/first-call-checklist/versions/${versionId}`;
        }

        const response = await fetch(url);

        if (!response.ok) {
          // API might fail if table doesn't exist yet - check for discovery questions directly
          const dqRes = await fetch("/api/discovery-questions/latest");
          if (dqRes.ok) {
            const dqData = await dqRes.json();
            setHasDiscoveryQuestions(dqData.hasDiscoveryQuestions || false);
          }
          return;
        }

        const data = await response.json();

        if (data.currentUserId) {
          setCurrentUserId(data.currentUserId);
        }

        if (versionId) {
          setVersion(data.version);
          setEditedContent(data.version?.content || "");
        } else {
          setHasDiscoveryQuestions(data.hasDiscoveryQuestions);
          if (data.hasFirstCallChecklist) {
            setVersion(data.version);
            setEditedContent(data.version?.content || "");
            // Update URL with version ID for sharing/bookmarking
            if (data.version?.id) {
              window.history.replaceState({}, "", `/first-call-checklist?version=${data.version.id}`);
            }
          }
        }

        // Check if pre-call checklist already exists
        try {
          const pcpRes = await fetch("/api/pre-call-planning/latest");
          if (pcpRes.ok) {
            const pcpData = await pcpRes.json();
            if (pcpData.hasPreCallPlanning) {
              setHasPreCallPlanning(true);
            }
          }
        } catch {
          // Ignore
        }
      } catch (error) {
        console.error("Error loading data:", error);
        // Try to check for discovery questions even if main call failed
        try {
          const dqRes = await fetch("/api/discovery-questions/latest");
          if (dqRes.ok) {
            const dqData = await dqRes.json();
            setHasDiscoveryQuestions(dqData.hasDiscoveryQuestions || false);
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

  // Auto-generate when arriving from a CTA link with ?auto=true
  useEffect(() => {
    if (autoGenerateRef.current && !loading && !version && hasDiscoveryQuestions && !generating) {
      autoGenerateRef.current = false;
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, version, hasDiscoveryQuestions]);

  // Detect background generation triggered from Discovery Questions page
  useEffect(() => {
    if (loading || version || generating) return;
    const startedAt = localStorage.getItem("fccGeneratingStarted");
    if (!startedAt) return;
    // Only honor if started within the last 3 minutes
    if (Date.now() - parseInt(startedAt) > 180000) {
      localStorage.removeItem("fccGeneratingStarted");
      return;
    }
    // Show generating state and poll for completion
    setGenerating(true);
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const res = await fetch("/api/first-call-checklist/latest");
          if (res.ok) {
            const data = await res.json();
            if (data.hasFirstCallChecklist && data.version) {
              setVersion(data.version);
              setGenerating(false);
              localStorage.removeItem("fccGeneratingStarted");
              if (data.version?.id) {
                window.history.replaceState({}, "", `/first-call-checklist?version=${data.version.id}`);
              }
              return;
            }
          }
        } catch {
          // Keep polling
        }
      }
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, version, generating]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/first-call-checklist/generate", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate first call checklist",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      if (data.version?.id) {
        window.history.replaceState({}, "", `/first-call-checklist?version=${data.version.id}`);
      }
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate first call checklist. Please try again.",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleImportText = async () => {
    if (!importText.trim() || importText.trim().length < 50) {
      await showAlert({ title: "Error", message: "Please provide more content (at least 50 characters).", variant: "danger" });
      return;
    }
    setImporting(true);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appletType: "firstCallChecklist", content: importText }),
      });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import content", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      if (data.version?.id) {
        window.history.replaceState({}, "", `/first-call-checklist?version=${data.version.id}`);
      }
      setShowImport(false);
      setImportText("");
    } catch (error) {
      console.error("Error importing:", error);
      await showAlert({ title: "Error", message: "Failed to import content. Please try again.", variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  const handleImportPDF = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("appletType", "firstCallChecklist");
      const response = await fetch("/api/import", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import PDF", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowImport(false);
      setImportText("");
    } catch (error) {
      console.error("Error importing PDF:", error);
      await showAlert({ title: "Error", message: "Failed to import PDF. Please try again.", variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  const handleCopy = async () => {
    if (!version) return;
    const success = await copyMarkdownAsRichText(version.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete First Call Checklist",
      message: "Are you sure you want to delete this First Call Checklist? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/first-call-checklist/versions/${version.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          window.location.href = "/first-call-checklist";
        } else {
          router.push("/first-call-checklist");
        }
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
      }
    } catch {
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
    }
  };

  const handleClone = async () => {
    if (!version) return;
    try {
      const res = await fetch("/api/documents/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: "firstCallChecklist", documentId: version.id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Error cloning:", error);
    }
  };

  const handleStartEditing = () => {
    if (version) {
      setEditTitle(version.title || "");
      setEditedContent(version.content);
    }
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (version) {
      setEditedContent(version.content);
    }
    setEditTitle("");
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!version) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/first-call-checklist/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent, title: editTitle }),
      });

      if (!response.ok) throw new Error("Failed to save");

      const data = await response.json();
      setVersion({
        ...version,
        title: data.version.title,
        content: data.version.content,
        updatedAt: data.version.updatedAt,
      });
      setEditTitle("");
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

  // Iterate handler — creates a new version
  const handleIterate = async () => {
    if (!version || !iterateFeedback.trim()) return;
    setIterating(true);
    try {
      const response = await fetch("/api/first-call-checklist/iterate", {
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
          if (line.startsWith("event: ")) currentEvent = line.slice(7);
          else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "complete") {
                setVersion({ ...version, id: data.versionId, title: data.title, content: data.content });
                setIterationPrompt(data.iterationPrompt);
                setIterateFeedback("");
                window.history.replaceState({}, "", `/first-call-checklist?version=${data.versionId}`);
              } else if (currentEvent === "error") {
                await showAlert({ title: "Error", message: data.message, variant: "danger" });
              }
            } catch { /* ignore */ }
            currentEvent = "";
          }
        }
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to iterate.", variant: "danger" });
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
            <p className="text-gray-600">Loading first call checklist...</p>
          </div>
        </div>
      </div>
    );
  }

  // No version yet - show generate + import options
  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-lg px-6">
            {showImport ? (
              <>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Import Your First Call Checklist</h1>
                <p className="text-gray-600 mb-6">
                  Paste your existing first call checklist or playbook below, or upload a PDF/CSV. We&apos;ll organize it into our format.
                </p>
                <div className="text-left space-y-4">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Paste your first call checklist or playbook here..."
                    rows={10}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-sm"
                    disabled={importing}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleImportText}
                      disabled={importing || importText.trim().length < 50}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium disabled:opacity-50"
                    >
                      {importing ? (
                        <>
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : "Import Text"}
                    </button>
                    <span className="text-gray-400 text-sm">or</span>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all font-medium disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Upload PDF / CSV
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportPDF(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  <button
                    onClick={() => { setShowImport(false); setImportText(""); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                    disabled={importing}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-6xl mb-4">📋</div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">First Call Checklist</h1>
                <p className="text-gray-600 mb-6">
                  {hasDiscoveryQuestions
                    ? "Generate a checklist from your discovery questions, or import your own."
                    : "Import your existing first call checklist, or create discovery questions first to auto-generate one."}
                </p>
                <div className="flex flex-col items-center gap-3">
                  {hasDiscoveryQuestions && (
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 w-full justify-center"
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
                          Generate from Discovery Questions
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setShowImport(true)}
                    disabled={generating}
                    className={`inline-flex items-center gap-2 px-6 py-3 ${hasDiscoveryQuestions ? "border border-gray-300 text-gray-700 hover:bg-gray-50" : "bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-md hover:shadow-lg"} rounded-lg transition-all font-medium disabled:opacity-50 w-full justify-center`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import Your Own
                  </button>
                  {!hasDiscoveryQuestions && (
                    <Link
                      href="/discovery-questions"
                      className="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all font-medium w-full justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Create Discovery Questions to Auto-Generate
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentContent = isEditing ? editedContent : version.content;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title="Generating First Call Checklist"
        subtitle="Building a structured checklist to nail your first call"
        emojis={["✅", "📋", "🎯"]}
        messages={[
          "Reviewing your discovery questions",
          "Mapping key talking points",
          "Structuring the call flow",
          "Adding qualification criteria",
          "Building your checklist",
          "Finalizing recommendations",
        ]}
      />
      {/* Header */}
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
                {isEditing ? (
                  <textarea
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="First Call Checklist"
                    rows={1}
                    className="text-xl font-semibold text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize"
                    style={{ minHeight: "2.5rem" }}
                  />
                ) : (
                  <h1 className="text-xl font-semibold text-gray-900">{version.title || "First Call Checklist"}</h1>
                )}
                <p className="text-sm text-gray-500">
                  Generated {formatDate(version.createdAt)}
                  {version.updatedAt !== version.createdAt && (
                    <> · Edited {formatDate(version.updatedAt)}</>
                  )}
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
                  <ChatAboutButton
                    title="Chat About First Call Checklist"
                    getContext={() => version?.content || ""}
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
                        Copy
                      </>
                    )}
                  </button>
                  <ShareDocumentButton
                    documentType="firstCallChecklist"
                    documentId={version.id}
                    title={version.title || "First Call Checklist"}
                    content={currentContent}
                  />
                  {version?.userId === currentUserId && (
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
                  <Link
                    href="/first-call-checklist/history"
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </Link>
                  {version?.userId === currentUserId && (
                  <button
                    onClick={handleClone}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
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
                      <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                    onRegenerate={handleGenerate}
                    onUploadPDF={handleImportPDF}
                    generating={generating}
                    importing={importing}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Dismissable Pre-Call Checklist Banner */}
        {showPreCallBanner && !isEditing && !hasPreCallPlanning && (
          <div className="mb-6 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="font-medium">
                Congrats on finishing your First Call Checklist! Now let&apos;s use this to{" "}
                <Link href="/pre-call-planning?auto=true" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                  create your pre-call checklist
                </Link>.
              </p>
            </div>
            <button
              onClick={() => setShowPreCallBanner(false)}
              className="flex-shrink-0 ml-4 p-1 hover:bg-white/20 rounded-full transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex gap-8">
        <div className="flex-1 min-w-0">
        {/* Iteration prompt banner */}
        {iterationPrompt && !isEditing && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-xl">
            <p className="text-xs font-medium text-purple-700 mb-1">Iterated with:</p>
            <p className="text-sm text-purple-900">&ldquo;{iterationPrompt}&rdquo;</p>
          </div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6">
            {isEditing ? (
              <RichTextEditor
                value={editedContent}
                onChange={(val) => setEditedContent(val)}
                height={600}
              />
            ) : (
              <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        {/* Source Info - only show when not editing */}
        {!isEditing && version.discoveryQuestionsVersion && (
          <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Generated From
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-800 font-medium">Discovery Questions</p>
                <p className="text-sm text-gray-500">
                  Created {formatDate(version.discoveryQuestionsVersion.createdAt)}
                </p>
              </div>
              <Link
                href={`/discovery-questions?version=${version.discoveryQuestionsVersionId}`}
                className="text-purple-600 hover:text-purple-700 text-sm font-medium"
              >
                View Questions →
              </Link>
            </div>
          </div>
        )}

        </div>{/* end main content */}

        {/* Right: Sidebar with Iterate */}
        {!isEditing && version && (
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="sticky top-8">
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Iterate
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Describe what to change and we&apos;ll create an updated version.
                </p>
                <textarea
                  value={iterateFeedback}
                  onChange={(e) => setIterateFeedback(e.target.value)}
                  placeholder="e.g., Add a section on pricing discovery, make the checklist shorter..."
                  rows={4}
                  disabled={iterating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y disabled:opacity-50 disabled:bg-gray-50"
                />
                <button
                  onClick={handleIterate}
                  disabled={iterating || !iterateFeedback.trim()}
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
            </div>
          </div>
        )}
        </div>{/* end flex row */}
      </div>
      {ConfirmModalElement}
    </div>
  );
}
