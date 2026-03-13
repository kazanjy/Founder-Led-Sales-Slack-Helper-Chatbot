"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { NewButtonDropdown } from "@/components/NewButtonDropdown";

const RichTextEditor = dynamic(
  () => import("@/components/RichTextEditor"),
  { ssr: false }
);

const ALL_PLATFORMS = [
  { id: "linkedin", label: "LinkedIn Ads" },
  { id: "facebook-instagram", label: "Facebook & Instagram Ads" },
  { id: "google-sem", label: "Google SEM Ads" },
];

interface AdCreatorVersion {
  id: string;
  content: string;
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string | null;
  platforms: string[];
  salesNarrativeVersionId: string;
  salesNarrativeVersion?: {
    id: string;
    createdAt: string;
  };
  firstCallChecklistVersionId?: string | null;
  iteratedFromId?: string | null;
  iterationNotes?: string | null;
  conversationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdCreatorPage() {
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
      <AdCreatorContent />
    </Suspense>
  );
}

function AdCreatorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [version, setVersion] = useState<AdCreatorVersion | null>(null);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [hasFirstCallChecklist, setHasFirstCallChecklist] = useState(false);
  const [copied, setCopied] = useState(false);

  // Persona form state
  const [showForm, setShowForm] = useState(false);
  const [orgPersona, setOrgPersona] = useState("");
  const [humanPersona, setHumanPersona] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(ALL_PLATFORMS.map(p => p.id));
  const [includeChecklist, setIncludeChecklist] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();
  const [importing, setImporting] = useState(false);

  // Iterate state
  const [showIterateModal, setShowIterateModal] = useState(false);
  const [iterating, setIterating] = useState(false);
  const [iterationNotes, setIterationNotes] = useState("");

  useEffect(() => {
    document.title = "Ad Creator - Mikey";
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

        fetch("/api/first-call-checklist/latest")
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.hasFirstCallChecklist) setHasFirstCallChecklist(true); })
          .catch(() => {});

        let url = "/api/ad-creator/latest";
        if (versionId) {
          url = `/api/ad-creator/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) return;

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          setEditedContent(data.version?.content || "");
          setHasSalesNarrative(true);
        } else {
          setHasSalesNarrative(data.hasSalesNarrative !== false);
          if (data.hasAdCreator) {
            setVersion(data.version);
            setEditedContent(data.version?.content || "");
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, versionId]);

  // Auto-prefill personas when form is visible
  useEffect(() => {
    if (!loading && !orgPersona && !humanPersona && !prefilling && hasSalesNarrative) {
      if (!version || showForm) {
        handlePrefill();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, showForm, version, hasSalesNarrative]);

  const handlePrefill = async () => {
    setPrefilling(true);
    try {
      const res = await fetch("/api/ad-creator/prefill-personas", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.orgPersona) setOrgPersona(data.orgPersona);
        if (data.humanPersona) setHumanPersona(data.humanPersona);
      }
    } catch {
      // silently fail
    } finally {
      setPrefilling(false);
    }
  };

  const handleTogglePlatform = (platformId: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platformId)
        ? prev.filter(p => p !== platformId)
        : [...prev, platformId]
    );
  };

  const handleGenerate = async () => {
    if (!orgPersona.trim() || !humanPersona.trim()) {
      await showAlert({
        title: "Missing Fields",
        message: "Please fill in both the organization persona and target audience.",
        variant: "danger",
      });
      return;
    }

    if (selectedPlatforms.length === 0) {
      await showAlert({
        title: "No Platforms Selected",
        message: "Please select at least one ad platform.",
        variant: "danger",
      });
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch("/api/ad-creator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgPersona: orgPersona.trim(),
          humanPersona: humanPersona.trim(),
          specialNotes: specialNotes.trim() || undefined,
          platforms: selectedPlatforms,
          includeFirstCallChecklist: includeChecklist,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate ad concepts",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowForm(false);
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate ad concepts. Please try again.",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (version) {
      setOrgPersona(version.orgPersona);
      setHumanPersona(version.humanPersona);
      setSpecialNotes(version.specialNotes || "");
      setSelectedPlatforms(version.platforms || ALL_PLATFORMS.map(p => p.id));
      setIncludeChecklist(!!version.firstCallChecklistVersionId);
    }
    setShowForm(true);
  };

  const handleIterate = async () => {
    if (!version || !iterationNotes.trim()) return;

    setIterating(true);
    try {
      const response = await fetch("/api/ad-creator/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: version.id,
          iterationNotes: iterationNotes.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to iterate on ad concepts",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowIterateModal(false);
      setIterationNotes("");
    } catch (error) {
      console.error("Error iterating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to iterate on ad concepts. Please try again.",
        variant: "danger",
      });
    } finally {
      setIterating(false);
    }
  };

  const handleImportPDF = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("appletType", "adCreator");
      const response = await fetch("/api/import", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import PDF", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowForm(false);
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

  const handleClone = async () => {
    if (!version) return;
    try {
      const res = await fetch("/api/documents/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: "adCreator", documentId: version.id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Error cloning:", error);
    }
  };

  const handleStartEditing = () => {
    if (version) setEditedContent(version.content);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (version) setEditedContent(version.content);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!version) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ad-creator/versions/${version.id}`, {
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
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };

  const platformLabels: Record<string, string> = {
    linkedin: "LinkedIn",
    "facebook-instagram": "FB/IG",
    "google-sem": "Google SEM",
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
            <p className="text-gray-600">Loading ad creator...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasSalesNarrative && !version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📖</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Narrative Required</h1>
            <p className="text-gray-600 mb-6">
              Ad concepts are generated from your sales narrative. Create a sales narrative first to get started.
            </p>
            <Link
              href="/sales-narrative"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              Create Sales Narrative
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // === FORM VIEW ===
  if (!version || showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="w-full max-w-lg px-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                📣 {version ? "Regenerate" : "Generate"} Ad Concepts
              </h1>
              <p className="text-gray-500 mb-6">Configure the target persona and platforms for your ads.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Organizational Persona
                  </label>
                  <div className="relative">
                    <textarea
                      value={orgPersona}
                      onChange={(e) => setOrgPersona(e.target.value)}
                      placeholder={prefilling ? "AI is thinking..." : "e.g. Series B SaaS company"}
                      disabled={prefilling}
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-none"
                    />
                    <button
                      onClick={handlePrefill}
                      disabled={prefilling}
                      className="absolute right-2 top-2 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors disabled:opacity-50"
                      title="AI Prefill"
                    >
                      {prefilling ? (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target Audience / Human Persona
                  </label>
                  <textarea
                    value={humanPersona}
                    onChange={(e) => setHumanPersona(e.target.value)}
                    placeholder={prefilling ? "AI is thinking..." : "e.g. VP of Sales"}
                    disabled={prefilling}
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Platforms
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_PLATFORMS.map(platform => (
                      <label
                        key={platform.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          selectedPlatforms.includes(platform.id)
                            ? "bg-purple-50 border-purple-300 text-purple-700"
                            : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes(platform.id)}
                          onChange={() => handleTogglePlatform(platform.id)}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm font-medium">{platform.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Special Notes <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="e.g. Focus on ROI messaging, we have a free trial offer..."
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  />
                </div>

                {hasFirstCallChecklist && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeChecklist}
                      onChange={(e) => setIncludeChecklist(e.target.checked)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    Include First Call Checklist context
                  </label>
                )}

                <div className="flex items-center gap-3 pt-2">
                  {version && (
                    <button
                      onClick={() => setShowForm(false)}
                      className="px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={generating || prefilling}
                    className="flex-1 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
                        Generate Ad Concepts
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  // === OUTPUT VIEW ===
  const currentContent = isEditing ? editedContent : version.content;

  // Extract platform section anchors for table of contents
  const tocItems = (version.platforms || []).map(p => ({
    id: p === "linkedin" ? "linkedin-ads" : p === "facebook-instagram" ? "facebook-instagram-ads" : "google-sem-ads",
    label: p === "linkedin" ? "LinkedIn Ads" : p === "facebook-instagram" ? "Facebook & Instagram Ads" : "Google SEM Ads",
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating || iterating}
        title={iterating ? "Iterating Ad Concepts" : "Generating Ad Concepts"}
        subtitle={iterating ? "Refining your ads based on your feedback" : "Creating multi-platform ad copy and creative direction"}
        emojis={["📣", "🎨", "📱"]}
        messages={[
          "Analyzing your sales narrative",
          "Crafting compelling headlines",
          "Designing creative concepts",
          "Optimizing for each platform",
          "Writing persuasive ad copy",
          "Polishing your campaigns",
        ]}
      />

      {/* Iterate Modal */}
      {showIterateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Iterate on Ad Concepts</h2>
            <p className="text-sm text-gray-500 mb-4">
              Describe how you&apos;d like to improve the current ad concepts. A new version will be generated based on your feedback.
            </p>
            <textarea
              value={iterationNotes}
              onChange={(e) => setIterationNotes(e.target.value)}
              placeholder="e.g. Make the LinkedIn ads more conversational, add urgency to Google SEM headlines, focus more on ROI messaging..."
              rows={5}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none mb-4"
              autoFocus
            />
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => { setShowIterateModal(false); setIterationNotes(""); }}
                className="px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleIterate}
                disabled={!iterationNotes.trim() || iterating}
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center gap-2"
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
                  "Generate New Version"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <h1 className="text-xl font-semibold text-gray-900">Ad Creator</h1>
                <p className="text-sm text-gray-500 leading-tight">
                  Generated {formatDate(version.createdAt)}
                  {version.updatedAt !== version.createdAt && (
                    <><br />Edited {formatDate(version.updatedAt)}</>
                  )}
                  {version.iteratedFromId && (
                    <><br /><span className="text-purple-600">Iterated version</span></>
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
                    title="Chat About Ad Concepts"
                    getContext={() => currentContent}
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
                    documentType="adCreator"
                    documentId={version.id}
                    title={`Ad Concepts: ${version.orgPersona} — ${version.humanPersona}`}
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
                  <button
                    onClick={() => setShowIterateModal(true)}
                    className="px-4 py-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors flex items-center gap-2 font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Iterate
                  </button>
                  <Link
                    href="/ad-creator/history"
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
                  <NewButtonDropdown
                    onRegenerate={handleRegenerate}
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

      <div className="max-w-5xl mx-auto px-6 py-8">
        {!isEditing && (
          <div className="flex flex-col gap-3 mb-6">
            <div className="px-4 py-3 bg-purple-50 text-purple-800 text-sm rounded-xl border border-purple-100">
              <span className="font-semibold text-purple-600">Org Persona:</span> {version.orgPersona}
            </div>
            <div className="px-4 py-3 bg-blue-50 text-blue-800 text-sm rounded-xl border border-blue-100">
              <span className="font-semibold text-blue-600">Target Audience:</span> {version.humanPersona}
            </div>
            <div className="px-4 py-3 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200 flex flex-wrap gap-2">
              <span className="font-semibold text-gray-500">Platforms:</span>
              {(version.platforms || []).map(p => (
                <span key={p} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs font-medium">
                  {platformLabels[p] || p}
                </span>
              ))}
            </div>
            {version.specialNotes && (
              <div className="px-4 py-3 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200">
                <span className="font-semibold text-gray-500">Notes:</span> {version.specialNotes}
              </div>
            )}
            {version.iterationNotes && (
              <div className="px-4 py-3 bg-amber-50 text-amber-800 text-sm rounded-xl border border-amber-100">
                <span className="font-semibold text-amber-600">Iteration guidance:</span> {version.iterationNotes}
              </div>
            )}
          </div>
        )}

        {/* Table of Contents */}
        {!isEditing && tocItems.length > 1 && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Jump to</h3>
            <div className="flex flex-wrap gap-2">
              {tocItems.map(item => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        )}

        {!isEditing && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Generated From
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-800 font-medium">Sales Narrative</p>
                {version.salesNarrativeVersion && (
                  <p className="text-sm text-gray-500">
                    Created {formatDate(version.salesNarrativeVersion.createdAt)}
                  </p>
                )}
              </div>
              <Link
                href="/sales-narrative"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-700 text-sm font-medium"
              >
                View Narrative →
              </Link>
            </div>
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
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h2: ({ children, ...props }) => {
                      const text = String(children);
                      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                      return <h2 id={id} {...props}>{children}</h2>;
                    },
                  }}
                >{currentContent}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
      {ConfirmModalElement}
    </div>
  );
}
