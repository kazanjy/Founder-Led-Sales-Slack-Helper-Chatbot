"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { NewButtonDropdown } from "@/components/NewButtonDropdown";

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
  title: string;
  content: DiscoveryQuestionsContent;
  salesNarrativeVersionId: string;
  salesNarrative?: {
    id: string;
    narrative: string;
    createdAt: string;
  };
  createdAt: string;
  userId: string;
  user?: { name: string | null; email: string | null; slackUserName: string | null; };
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
  const [showChecklistBanner, setShowChecklistBanner] = useState(true);
  const [hasFirstCallChecklist, setHasFirstCallChecklist] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState<DiscoveryQuestionsContent | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();
  const autoGenerateRef = useRef(searchParams.get("auto") === "true");

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

        if (data.currentUserId) {
          setCurrentUserId(data.currentUserId);
        }

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
            // Update URL with version ID for sharing/bookmarking
            if (data.version?.id) {
              window.history.replaceState({}, "", `/discovery-questions?version=${data.version.id}`);
            }
          }
        }

        // Check if first call checklist already exists
        try {
          const fccRes = await fetch("/api/first-call-checklist/latest");
          if (fccRes.ok) {
            const fccData = await fccRes.json();
            if (fccData.hasFirstCallChecklist) {
              setHasFirstCallChecklist(true);
            }
          }
        } catch {
          // Ignore
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

  // Auto-generate when arriving from a CTA link with ?auto=true
  useEffect(() => {
    if (autoGenerateRef.current && !loading && !version && hasSalesNarrative && !generating) {
      autoGenerateRef.current = false;
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, version, hasSalesNarrative]);

  const handleClone = async () => {
    if (!version) return;
    try {
      const res = await fetch("/api/documents/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: "discoveryQuestions", documentId: version.id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Error cloning:", error);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/discovery-questions/generate", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate discovery questions",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      if (data.version?.content?.categories) {
        setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
      }
      // Update URL with version ID for sharing/bookmarking
      if (data.version?.id) {
        window.history.replaceState({}, "", `/discovery-questions?version=${data.version.id}`);
      }
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate discovery questions. Please try again.",
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
        body: JSON.stringify({ appletType: "discoveryQuestions", content: importText }),
      });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import content", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      if (data.version?.content?.categories) {
        setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
      }
      // Update URL with version ID for sharing/bookmarking
      if (data.version?.id) {
        window.history.replaceState({}, "", `/discovery-questions?version=${data.version.id}`);
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
      formData.append("appletType", "discoveryQuestions");
      const response = await fetch("/api/import", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import PDF", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      if (data.version?.content?.categories) {
        setExpandedCategories(new Set(data.version.content.categories.map((c: Category) => c.name)));
      }
      // Update URL with version ID for sharing/bookmarking
      if (data.version?.id) {
        window.history.replaceState({}, "", `/discovery-questions?version=${data.version.id}`);
      }
      setShowImport(false);
      setImportText("");
    } catch (error) {
      console.error("Error importing PDF:", error);
      await showAlert({ title: "Error", message: "Failed to import PDF. Please try again.", variant: "danger" });
    } finally {
      setImporting(false);
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

    const success = await copyMarkdownAsRichText(allQuestions.trim());
    if (success) {
      setCopiedQuestion("all");
      setTimeout(() => setCopiedQuestion(null), 2000);
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

  const handleStartEditing = () => {
    if (!version) return;
    setEditContent(JSON.parse(JSON.stringify(version.content)));
    setEditTitle(version.title || "");
    setIsEditing(true);
    // Expand all categories when editing
    if (version.content.categories) {
      setExpandedCategories(new Set(version.content.categories.map(c => c.name)));
    }
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditContent(null);
    setEditTitle("");
  };

  const handleSave = async () => {
    if (!version || !editContent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/discovery-questions/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, title: editTitle }),
      });
      if (!res.ok) {
        const data = await res.json();
        await showAlert({ title: "Error", message: data.error || "Failed to save changes", variant: "danger" });
        return;
      }
      const data = await res.json();
      setVersion({ ...version, content: data.version.content, title: data.version.title });
      setIsEditing(false);
      setEditContent(null);
      setEditTitle("");
    } catch (error) {
      console.error("Error saving:", error);
      await showAlert({ title: "Error", message: "Failed to save changes. Please try again.", variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const updateQuestion = (catIdx: number, qIdx: number, field: "primary", value: string) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: cat.questions.map((q, qi) =>
        qi !== qIdx ? q : { ...q, [field]: value }
      )}
    )};
    setEditContent(updated);
  };

  const updateFollowUp = (catIdx: number, qIdx: number, fIdx: number, value: string) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: cat.questions.map((q, qi) =>
        qi !== qIdx ? q : { ...q, followUps: q.followUps.map((f, fi) => fi === fIdx ? value : f) }
      )}
    )};
    setEditContent(updated);
  };

  const addFollowUp = (catIdx: number, qIdx: number) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: cat.questions.map((q, qi) =>
        qi !== qIdx ? q : { ...q, followUps: [...q.followUps, ""] }
      )}
    )};
    setEditContent(updated);
  };

  const removeFollowUp = (catIdx: number, qIdx: number, fIdx: number) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: cat.questions.map((q, qi) =>
        qi !== qIdx ? q : { ...q, followUps: q.followUps.filter((_, fi) => fi !== fIdx) }
      )}
    )};
    setEditContent(updated);
  };

  const addQuestion = (catIdx: number) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: [...cat.questions, { primary: "", followUps: [] }] }
    )};
    setEditContent(updated);
  };

  const removeQuestion = (catIdx: number, qIdx: number) => {
    if (!editContent) return;
    const updated = { ...editContent, categories: editContent.categories.map((cat, ci) =>
      ci !== catIdx ? cat : { ...cat, questions: cat.questions.filter((_, qi) => qi !== qIdx) }
    )};
    setEditContent(updated);
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
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading discovery questions...</p>
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
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Import Your Discovery Questions</h1>
                <p className="text-gray-600 mb-6">
                  Paste your existing discovery questions below or upload a PDF/CSV. We&apos;ll organize them into our format.
                </p>
                <div className="text-left space-y-4">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Paste your discovery questions here..."
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
                <div className="text-6xl mb-4">🔍</div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Discovery Questions</h1>
                <p className="text-gray-600 mb-6">
                  {hasSalesNarrative
                    ? "Generate discovery questions from your sales narrative, or import your own."
                    : "Import your existing discovery questions, or create a sales narrative first to auto-generate them."}
                </p>
                <div className="flex flex-col items-center gap-3">
                  {hasSalesNarrative && (
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
                          Generate from Sales Narrative
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setShowImport(true)}
                    disabled={generating}
                    className={`inline-flex items-center gap-2 px-6 py-3 ${hasSalesNarrative ? "border border-gray-300 text-gray-700 hover:bg-gray-50" : "bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-md hover:shadow-lg"} rounded-lg transition-all font-medium disabled:opacity-50 w-full justify-center`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import Your Own
                  </button>
                  {!hasSalesNarrative && (
                    <Link
                      href="/sales-narrative/edit"
                      className="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all font-medium w-full justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Create Sales Narrative to Auto-Generate
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

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title="Generating Discovery Questions"
        subtitle="Creating targeted questions to uncover your prospect's needs"
        emojis={["🔍", "❓", "💡"]}
        messages={[
          "Analyzing your sales narrative",
          "Identifying key pain points",
          "Crafting probing questions",
          "Building follow-up sequences",
          "Organizing by category",
          "Polishing question flow",
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
                    placeholder="Discovery Questions"
                    rows={1}
                    className="text-xl font-semibold text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize"
                    style={{ minHeight: "2.5rem" }}
                  />
                ) : (
                  <h1 className="text-xl font-semibold text-gray-900">{version.title || "Discovery Questions"}</h1>
                )}
                <p className="text-sm text-gray-500">
                  Generated {formatDate(version.createdAt)} · {getTotalQuestions()} questions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancelEditing}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg disabled:opacity-50"
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
                      "Save Changes"
                    )}
                  </button>
                </>
              ) : (
                <>
                  <ChatAboutButton
                    title="Chat About Discovery Questions"
                    getContext={() => {
                      if (!version?.content?.categories) return "";
                      let content = "";
                      for (const category of version.content.categories) {
                        content += `## ${category.name}\n${category.description ? category.description + "\n" : ""}\n`;
                        for (let i = 0; i < category.questions.length; i++) {
                          const q = category.questions[i];
                          content += `${i + 1}. ${q.primary}\n`;
                          if (q.followUps?.length > 0) {
                            for (const followUp of q.followUps) {
                              content += `   - ${followUp}\n`;
                            }
                          }
                          content += "\n";
                        }
                      }
                      return content;
                    }}
                  />
                  <ShareDocumentButton
                    documentType="discoveryQuestions"
                    documentId={version.id}
                    title={version.title || "Discovery Questions"}
                    content={version.content.categories.map((cat: { name: string; questions: { primary: string; followUps?: string[] }[] }) =>
                      `## ${cat.name}\n\n${cat.questions.map((q: { primary: string; followUps?: string[] }, i: number) =>
                        `${i + 1}. ${q.primary}${q.followUps?.length ? "\n" + q.followUps.map((f: string) => `   - ${f}`).join("\n") : ""}`
                      ).join("\n\n")}`
                    ).join("\n\n")}
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
        {/* Dismissable First Call Checklist Banner */}
        {showChecklistBanner && !hasFirstCallChecklist && (
          <div className="mb-6 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="font-medium">
                Congrats on finishing your Discovery Questions! Now let&apos;s use this to{" "}
                <Link href="/first-call-checklist?auto=true" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                  create your first call checklist
                </Link>.
              </p>
            </div>
            <button
              onClick={() => setShowChecklistBanner(false)}
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
        {/* Left: Main content */}
        <div className="flex-1 min-w-0">
        <div className="space-y-4">
          {(isEditing && editContent ? editContent.categories : version.content.categories).map((category, catIdx) => {
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
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-400 font-medium mt-2 text-sm">{idx + 1}.</span>
                              <textarea
                                value={question.primary}
                                onChange={(e) => updateQuestion(catIdx, idx, "primary", e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                rows={2}
                              />
                              <button
                                onClick={() => removeQuestion(catIdx, idx)}
                                className="text-red-400 hover:text-red-600 p-1 mt-1"
                                title="Remove question"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                            {question.followUps && question.followUps.length > 0 && (
                              <div className="pl-7 space-y-2">
                                <p className="text-xs text-gray-400 font-medium">Follow-ups:</p>
                                {question.followUps.map((followUp, fIdx) => (
                                  <div key={fIdx} className="flex items-start gap-2">
                                    <span className="text-gray-300 mt-2">→</span>
                                    <textarea
                                      value={followUp}
                                      onChange={(e) => updateFollowUp(catIdx, idx, fIdx, e.target.value)}
                                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                      rows={1}
                                    />
                                    <button
                                      onClick={() => removeFollowUp(catIdx, idx, fIdx)}
                                      className="text-red-300 hover:text-red-500 p-1"
                                      title="Remove follow-up"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="pl-7">
                              <button
                                onClick={() => addFollowUp(catIdx, idx)}
                                className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                              >
                                + Add Follow-up
                              </button>
                            </div>
                          </div>
                        ) : (
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
                        )}
                      </div>
                    ))}
                    {isEditing && (
                      <button
                        onClick={() => addQuestion(catIdx)}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-colors"
                      >
                        + Add Question
                      </button>
                    )}
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

        </div>{/* end main content */}

        {/* Right sidebar: First Call Checklist ad widget */}
        {!hasFirstCallChecklist && <div className="hidden lg:block w-64 flex-shrink-0">
          <div className="sticky top-8">
            <div className="bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl p-5 text-white shadow-lg">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="font-bold text-lg mb-2">First Call Checklist</h3>
              <p className="text-purple-100 text-sm mb-4">
                Turn your discovery questions into a structured checklist for your first sales calls.
              </p>
              <Link
                href="/first-call-checklist?auto=true"
                className="block w-full text-center px-4 py-2.5 bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
              >
                Create Checklist
              </Link>
            </div>

            <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-medium text-gray-900 text-sm mb-3">More GTM Tools</h4>
              <div className="space-y-2">
                <Link
                  href="/chat"
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors py-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat About It
                </Link>
                <Link
                  href="/sales-narrative"
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors py-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Sales Narrative
                </Link>
                <Link
                  href="/assessment/bulk"
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors py-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  GTM Assessment
                </Link>
              </div>
            </div>
          </div>
        </div>}
        </div>{/* end flex row */}
      </div>
      {ConfirmModalElement}
    </div>
  );
}
