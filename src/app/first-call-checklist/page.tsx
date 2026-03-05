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

// Dynamically import RichTextEditor to avoid SSR issues
const RichTextEditor = dynamic(
  () => import("@/components/RichTextEditor"),
  { ssr: false }
);

interface FirstCallChecklistVersion {
  id: string;
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

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();
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

        if (versionId) {
          setVersion(data.version);
          setEditedContent(data.version?.content || "");
        } else {
          setHasDiscoveryQuestions(data.hasDiscoveryQuestions);
          if (data.hasFirstCallChecklist) {
            setVersion(data.version);
            setEditedContent(data.version?.content || "");
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

  const handleCopy = async () => {
    if (!version) return;
    const success = await copyMarkdownAsRichText(version.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
      setEditedContent(version.content);
    }
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (version) {
      setEditedContent(version.content);
    }
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!version) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/first-call-checklist/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });

      if (!response.ok) throw new Error("Failed to save");

      const data = await response.json();
      setVersion({
        ...version,
        content: data.version.content,
        updatedAt: data.version.updatedAt,
      });
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

  // No discovery questions - need to create them first
  if (!hasDiscoveryQuestions && !version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">🔍</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Discovery Questions Required</h1>
            <p className="text-gray-600 mb-6">
              The first call checklist is generated from your discovery questions. Create discovery questions first to get started.
            </p>
            <Link
              href="/discovery-questions"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Create Discovery Questions
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Has discovery questions but no checklist yet
  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📋</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Generate First Call Checklist</h1>
            <p className="text-gray-600 mb-6">
              Create a comprehensive checklist to prepare for and execute your first sales calls with prospects.
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
                  Generate First Call Checklist
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentContent = isEditing ? editedContent : version.content;

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
                <h1 className="text-xl font-semibold text-gray-900">First Call Checklist</h1>
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
                    title="First Call Checklist"
                    content={currentContent}
                  />
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
                    href="/first-call-checklist/history"
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </Link>
                  <button
                    onClick={handleClone}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Clone
                  </button>
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
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

      </div>
      {ConfirmModalElement}
    </div>
  );
}
