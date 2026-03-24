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

interface IcpSection {
  name: string;
  description: string;
  items: string[];
}

interface SearchFilter {
  facet: string;
  values: string[];
  notes?: string;
}

interface PlatformCriteria {
  name: string;
  filters: SearchFilter[];
  booleanSearch?: string;
  tips?: string[];
}

interface IcpContent {
  sections: IcpSection[];
  searchCriteria?: PlatformCriteria[];
}

interface IcpVersion {
  id: string;
  title: string;
  content: IcpContent;
  salesNarrativeVersionId: string;
  salesNarrative?: { id: string; createdAt: string };
  createdAt: string;
  updatedAt: string;
  userId: string;
}

const validTabs = ["profile", "search-criteria"] as const;
type Tab = (typeof validTabs)[number];

const getTabFromHash = (): Tab => {
  if (typeof window === "undefined") return "profile";
  const hash = window.location.hash.replace("#", "");
  return validTabs.includes(hash as Tab) ? (hash as Tab) : "profile";
};

export default function IcpPage() {
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
      <IcpContent />
    </Suspense>
  );
}

function IcpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [version, setVersion] = useState<IcpVersion | null>(null);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [copied, setCopied] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState<IcpContent | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // UI state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Discovery Questions next-step state
  const [showDqBanner, setShowDqBanner] = useState(true);
  const [hasDiscoveryQuestions, setHasDiscoveryQuestions] = useState(false);
  const [dqGenerating, setDqGenerating] = useState(false);
  const [dqDone, setDqDone] = useState(false);
  const dqGenerationTriggered = useRef(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>(getTabFromHash);
  const [generatingCriteria, setGeneratingCriteria] = useState(false);
  const [copiedFilter, setCopiedFilter] = useState<string | null>(null);

  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Ideal Customer Profile - Mikey";
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.hash = tab;
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        let url = "/api/icp/latest";
        if (versionId) {
          url = `/api/icp/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          const narrativeRes = await fetch("/api/sales-narrative/latest").then(r => r.ok ? r.json() : null).catch(() => null);
          setHasSalesNarrative(!!narrativeRes?.hasNarrative);
          return;
        }

        const data = await response.json();

        if (data.currentUserId) {
          setCurrentUserId(data.currentUserId);
        }

        if (versionId) {
          setVersion(data.version);
          setHasSalesNarrative(true);
          // Expand all sections by default
          if (data.version?.content?.sections) {
            setExpandedSections(new Set(data.version.content.sections.map((s: IcpSection) => s.name)));
          }
        } else {
          setHasSalesNarrative(data.hasSalesNarrative !== false);
          if (data.hasIcp) {
            setVersion(data.version);
            // Expand all sections by default
            if (data.version?.content?.sections) {
              setExpandedSections(new Set(data.version.content.sections.map((s: IcpSection) => s.name)));
            }
          }
        }

        // Check if discovery questions exist
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

    loadData();
  }, [router, versionId]);

  // Auto-generate if ?auto=true
  useEffect(() => {
    const autoGenerate = searchParams.get("auto");
    if (autoGenerate === "true" && !loading && !version && hasSalesNarrative && !generating) {
      handleGenerate();
      // Clean URL
      router.replace("/icp");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasSalesNarrative]);

  // Detect background ICP generation triggered from Sales Narrative page
  useEffect(() => {
    if (loading || version || generating) return;
    const startedAt = localStorage.getItem("icpGeneratingStarted");
    if (!startedAt) return;
    // Only honor if started within the last 3 minutes
    if (Date.now() - parseInt(startedAt) > 180000) {
      localStorage.removeItem("icpGeneratingStarted");
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
          const res = await fetch("/api/icp/latest");
          if (res.ok) {
            const data = await res.json();
            if (data.hasIcp && data.version) {
              setVersion(data.version);
              if (data.version?.content?.sections) {
                setExpandedSections(new Set(data.version.content.sections.map((s: IcpSection) => s.name)));
              }
              setGenerating(false);
              localStorage.removeItem("icpGeneratingStarted");
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

  // Auto-trigger Discovery Questions generation when ICP exists but DQ doesn't
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
        localStorage.removeItem("dqGeneratingStarted");
      })
      .finally(() => {
        setDqGenerating(false);
      });
  }, [loading, version, hasDiscoveryQuestions, dqGenerating, dqDone]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/icp/generate", { method: "POST" });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to generate ICP", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      // Expand all sections by default
      if (data.version?.content?.sections) {
        setExpandedSections(new Set(data.version.content.sections.map((s: IcpSection) => s.name)));
      }
      // Auto-generate search criteria in the background
      if (data.version?.id) {
        generateSearchCriteriaInBackground(data.version.id);
      }
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({ title: "Error", message: "Failed to generate ICP. Please try again.", variant: "danger" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    handleGenerate();
  };

  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete Ideal Customer Profile",
      message: "Are you sure you want to delete this ICP? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/icp/versions/${version.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          window.location.href = "/icp";
        } else {
          router.push("/icp");
        }
      } else {
        await showAlert({ title: "Error", message: "Failed to delete this ICP. Please try again.", variant: "danger" });
      }
    } catch (error) {
      console.error("Error deleting ICP:", error);
      await showAlert({ title: "Error", message: "Failed to delete this ICP. Please try again.", variant: "danger" });
    }
  };

  const handleCopyAll = async () => {
    if (!version) return;
    let markdown = `# ${version.title}\n\n`;
    for (const section of version.content.sections) {
      markdown += `## ${section.name}\n`;
      if (section.description) markdown += `*${section.description}*\n\n`;
      for (const item of section.items) {
        markdown += `- ${item}\n`;
      }
      markdown += "\n";
    }
    const success = await copyMarkdownAsRichText(markdown);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStartEditing = () => {
    if (!version) return;
    setEditContent(JSON.parse(JSON.stringify(version.content)));
    setEditTitle(version.title);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditContent(null);
  };

  const handleSave = async () => {
    if (!version || !editContent) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/icp/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, title: editTitle }),
      });
      if (!response.ok) {
        await showAlert({ title: "Error", message: "Failed to save changes", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion({
        ...version,
        content: data.version.content,
        title: data.version.title,
        updatedAt: data.version.updatedAt,
      });
      setIsEditing(false);
      setEditContent(null);
    } catch {
      await showAlert({ title: "Error", message: "Failed to save", variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const handleImportText = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: importText,
          appletType: "icp",
        }),
      });
      if (!response.ok) {
        await showAlert({ title: "Import Error", message: "Failed to import content", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setShowImport(false);
      // Auto-generate search criteria in the background
      if (data.version?.id) {
        generateSearchCriteriaInBackground(data.version.id);
      }
      setImportText("");
      if (data.version?.content?.sections) {
        setExpandedSections(new Set(data.version.content.sections.map((s: IcpSection) => s.name)));
      }
    } catch {
      await showAlert({ title: "Error", message: "Failed to import", variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  const generateSearchCriteriaInBackground = (versionId: string) => {
    setGeneratingCriteria(true);
    fetch("/api/icp/generate-search-criteria", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.searchCriteria) {
          setVersion(prev => prev ? { ...prev, content: { ...prev.content, searchCriteria: data.searchCriteria } } : prev);
        }
      })
      .catch(() => {})
      .finally(() => setGeneratingCriteria(false));
  };

  const handleGenerateSearchCriteria = async () => {
    if (!version) return;
    setGeneratingCriteria(true);
    try {
      const response = await fetch("/api/icp/generate-search-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to generate search criteria", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion({
        ...version,
        content: { ...version.content, searchCriteria: data.searchCriteria },
      });
    } catch {
      await showAlert({ title: "Error", message: "Failed to generate search criteria. Please try again.", variant: "danger" });
    } finally {
      setGeneratingCriteria(false);
    }
  };

  const copyFilterValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFilter(key);
      setTimeout(() => setCopiedFilter(null), 2000);
    } catch {
      // fallback
    }
  };

  const toggleSection = (name: string) => {
    const next = new Set(expandedSections);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedSections(next);
  };

  // Edit helpers
  const updateItem = (sectionIndex: number, itemIndex: number, value: string) => {
    if (!editContent) return;
    const updated = { ...editContent, sections: [...editContent.sections] };
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      items: [...updated.sections[sectionIndex].items],
    };
    updated.sections[sectionIndex].items[itemIndex] = value;
    setEditContent(updated);
  };

  const addItem = (sectionIndex: number) => {
    if (!editContent) return;
    const updated = { ...editContent, sections: [...editContent.sections] };
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      items: [...updated.sections[sectionIndex].items, ""],
    };
    setEditContent(updated);
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    if (!editContent) return;
    const updated = { ...editContent, sections: [...editContent.sections] };
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      items: updated.sections[sectionIndex].items.filter((_, i) => i !== itemIndex),
    };
    setEditContent(updated);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const sectionColors: Record<string, { bg: string; border: string; text: string }> = {
    "Company Characteristics": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
    "Key Personas": { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
    "Pain Points & Challenges": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
    "Buying Signals & Triggers": { bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
    "Qualification Criteria": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
    "Red Flags & Disqualifiers": { bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-700" },
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
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // No version — show onboarding
  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <GeneratingOverlay
          visible={generating}
          title="Building Your ICP"
          subtitle="Analyzing your sales narrative to define your ideal customer"
          emojis={["👤", "🎯", "🏢"]}
          messages={[
            "Analyzing your product and market",
            "Identifying ideal company characteristics",
            "Mapping key personas and buyers",
            "Defining pain points and triggers",
            "Building qualification criteria",
          ]}
        />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="max-w-lg w-full px-6">
            <div className="text-center mb-8">
              <div className="text-5xl mb-4">👤</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Ideal Customer Profile</h1>
              <p className="text-gray-600">
                Define exactly who your best customers are — company traits, personas, pain points, and buying signals.
              </p>
            </div>

            <div className="space-y-4">
              {hasSalesNarrative ? (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="w-full py-4 px-6 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-purple-400 transition-colors text-lg font-medium flex items-center justify-center gap-3"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate from Sales Narrative
                </button>
              ) : (
                <div className="text-center py-6 bg-white rounded-xl border border-gray-200">
                  <p className="text-gray-600 mb-3">Complete your Sales Narrative first to auto-generate your ICP.</p>
                  <Link href="/sales-narrative" className="text-purple-600 hover:text-purple-700 font-medium">
                    Go to Sales Narrative →
                  </Link>
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                <div className="relative flex justify-center"><span className="bg-gray-50 px-4 text-sm text-gray-400">or</span></div>
              </div>

              <button
                onClick={() => setShowImport(true)}
                className="w-full py-4 px-6 bg-white text-gray-700 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-lg font-medium flex items-center justify-center gap-3"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import Your Own
              </button>
            </div>
          </div>
        </div>

        {/* Import Modal */}
        {showImport && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Import Your ICP</h3>
              <p className="text-sm text-gray-500 mb-4">Paste your existing ICP documentation and we&apos;ll structure it for you.</p>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                rows={10}
                placeholder="Paste your ICP here..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm resize-none"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setShowImport(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                <button
                  onClick={handleImportText}
                  disabled={importing || !importText.trim()}
                  className="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-400 transition-colors font-medium"
                >
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>
        )}
        {ConfirmModalElement}
      </div>
    );
  }

  // Detail view
  const contentToRender = isEditing ? editContent! : version.content;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title="Building Your ICP"
        subtitle="Analyzing your sales narrative to define your ideal customer"
        emojis={["👤", "🎯", "🏢"]}
        messages={[
          "Analyzing your product and market",
          "Identifying ideal company characteristics",
          "Mapping key personas and buyers",
          "Defining pain points and triggers",
          "Building qualification criteria",
        ]}
      />

      <GeneratingOverlay
        visible={generatingCriteria}
        title="Building Search Criteria"
        subtitle="Translating your ICP into platform-specific search filters"
        emojis={["🔍", "🎯", "📋"]}
        messages={[
          "Mapping ICP to LinkedIn Sales Navigator filters",
          "Building boolean search queries",
          "Configuring Apollo.io filters",
          "Generating Google X-Ray search strings",
          "Adding platform-specific tips",
        ]}
      />

      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <Link href="/chat" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="text-xl font-semibold text-gray-900 border-b-2 border-purple-300 focus:border-purple-600 outline-none bg-transparent"
                  />
                ) : (
                  <h1 className="text-xl font-semibold text-gray-900">{version.title}</h1>
                )}
                <p className="text-sm text-gray-500 leading-tight">
                  Generated {formatDate(version.createdAt)}
                  {version.updatedAt !== version.createdAt && (
                    <><br />Edited {formatDate(version.updatedAt)}</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {isEditing ? (
                <>
                  <button onClick={handleCancelEditing} disabled={saving} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50">
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </>
              ) : (
                <>
                  {activeTab === "profile" && (
                    <>
                      <ChatAboutButton title="Chat About ICP" getContext={() => {
                        let md = `# ${version.title}\n\n`;
                        for (const section of version.content.sections) {
                          md += `## ${section.name}\n`;
                          for (const item of section.items) md += `- ${item}\n`;
                          md += "\n";
                        }
                        return md;
                      }} />
                      <button onClick={handleCopyAll} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                        {copied ? (
                          <><svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                        ) : (
                          <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                        )}
                      </button>
                      <ShareDocumentButton
                        documentType="icp"
                        documentId={version.id}
                        title={version.title}
                        content={(() => {
                          let md = "";
                          for (const section of version.content.sections) {
                            md += `## ${section.name}\n`;
                            for (const item of section.items) md += `- ${item}\n`;
                            md += "\n";
                          }
                          return md;
                        })()}
                      />
                      <button onClick={handleStartEditing} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Edit
                      </button>
                    </>
                  )}
                  {version?.userId === currentUserId && (
                    <button
                      onClick={handleDelete}
                      className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  )}
                  {activeTab === "search-criteria" && version.content.searchCriteria && (
                    <button onClick={handleGenerateSearchCriteria} disabled={generatingCriteria} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Regenerate
                    </button>
                  )}
                  <Link href="/icp/history" className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    History
                  </Link>
                  <NewButtonDropdown onRegenerate={handleRegenerate} onUploadPDF={() => {}} generating={generating} />
                </>
              )}
            </div>
          </div>

          {/* Tabs */}
          {!isEditing && (
            <div className="flex gap-2 mt-4 -mb-4 border-b-0">
              <button
                onClick={() => switchTab("profile")}
                className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "profile"
                    ? "border-purple-600 text-purple-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                ICP Profile
              </button>
              <button
                onClick={() => switchTab("search-criteria")}
                className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "search-criteria"
                    ? "border-purple-600 text-purple-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Search Criteria
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Profile Tab Content */}
      {activeTab === "profile" && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Dismissable Next Step Banner - Discovery Questions generation status */}
          {showDqBanner && !isEditing && (
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
                      from your ICP...
                    </>
                  ) : dqDone ? (
                    <>
                      Your{" "}
                      <Link href="/discovery-questions" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                        Discovery Questions
                      </Link>{" "}
                      are ready! Done!
                    </>
                  ) : hasDiscoveryQuestions ? (
                    <>
                      Your ICP is ready! Now let&apos;s use this to{" "}
                      <Link href="/discovery-questions" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                        create your discovery questions
                      </Link>.
                    </>
                  ) : (
                    <>
                      Congrats on finishing your ICP! Now let&apos;s{" "}
                      <Link href="/discovery-questions?auto=true" target="_blank" className="underline underline-offset-2 hover:text-purple-100 font-semibold">
                        create your discovery questions
                      </Link>.
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowDqBanner(false)}
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
            {contentToRender.sections.map((section, sectionIndex) => {
              const colors = sectionColors[section.name] || { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700" };
              const isExpanded = expandedSections.has(section.name);

              return (
                <div key={section.name} className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
                  <button
                    onClick={() => toggleSection(section.name)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${colors.text}`}>{section.name}</span>
                      <span className="text-sm text-gray-500">{section.items.length} items</span>
                    </div>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-6 pb-4">
                      {section.description && (
                        <p className="text-sm text-gray-500 italic mb-3">{section.description}</p>
                      )}
                      <div className="space-y-2">
                        {section.items.map((item, itemIndex) => (
                          <div key={itemIndex} className="flex items-start gap-3">
                            {isEditing ? (
                              <>
                                <textarea
                                  value={item}
                                  onChange={e => updateItem(sectionIndex, itemIndex, e.target.value)}
                                  rows={2}
                                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                                />
                                <button
                                  onClick={() => removeItem(sectionIndex, itemIndex)}
                                  className="text-red-400 hover:text-red-600 mt-2"
                                  title="Remove item"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${colors.text.replace("text-", "bg-")}`}></span>
                                <span className="text-gray-700 text-sm">{item}</span>
                              </>
                            )}
                          </div>
                        ))}
                        {isEditing && (
                          <button
                            onClick={() => addItem(sectionIndex)}
                            className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1 mt-2"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add item
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Expand/collapse all */}
          {!isEditing && version.content.sections.length > 0 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  if (expandedSections.size === version.content.sections.length) {
                    setExpandedSections(new Set());
                  } else {
                    setExpandedSections(new Set(version.content.sections.map(s => s.name)));
                  }
                }}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                {expandedSections.size === version.content.sections.length ? "Collapse All" : "Expand All"}
              </button>
            </div>
          )}
          </div>

          {/* Right sidebar: Next step CTA widget - Discovery Questions status */}
          {!isEditing && (
            <div className="hidden lg:block w-64 flex-shrink-0">
              <div className="sticky top-8">
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
                        Generating your Discovery Questions from your ICP...
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
                        Your Discovery Questions have been generated from your ICP!
                      </p>
                      <Link
                        href="/discovery-questions"
                        target="_blank"
                        className="block w-full text-center px-4 py-2.5 bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
                      >
                        Done! View Questions
                      </Link>
                    </>
                  ) : hasDiscoveryQuestions ? (
                    <>
                      <h3 className="font-bold text-lg mb-2">Discovery Questions</h3>
                      <p className="text-purple-100 text-sm mb-4">
                        Turn your ICP into powerful discovery questions that uncover buyer pain points.
                      </p>
                      <Link
                        href="/discovery-questions"
                        target="_blank"
                        className="block w-full text-center px-4 py-2.5 bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
                      >
                        View Questions
                      </Link>
                    </>
                  ) : (
                    <>
                      <h3 className="font-bold text-lg mb-2">Discovery Questions</h3>
                      <p className="text-purple-100 text-sm mb-4">
                        Turn your ICP into powerful discovery questions that uncover buyer pain points.
                      </p>
                      <Link
                        href="/discovery-questions?auto=true"
                        target="_blank"
                        className="block w-full text-center px-4 py-2.5 bg-white text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-semibold text-sm"
                      >
                        Create Questions
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Search Criteria Tab Content */}
      {activeTab === "search-criteria" && (
        <div className="max-w-5xl mx-auto px-6 py-8">
          {!version.content.searchCriteria ? (
            /* Empty state — criteria not yet generated */
            <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 250px)" }}>
              <div className="max-w-md w-full text-center">
                {generatingCriteria ? (
                  <>
                    <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600">Generating search criteria from your ICP...</p>
                  </>
                ) : (
                  <>
                    <div className="text-5xl mb-4">🔍</div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Search Criteria</h2>
                    <p className="text-gray-600 mb-6">
                      Translate your ICP into ready-to-use search filters for LinkedIn Sales Navigator and Apollo.io.
                    </p>
                    <button
                      onClick={handleGenerateSearchCriteria}
                      className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2 mx-auto"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Search Criteria
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Criteria results */
            <div className="space-y-6">
              {version.content.searchCriteria.map((platform) => {
                const platformColors: Record<string, { bg: string; border: string; text: string; accent: string }> = {
                  "LinkedIn Sales Navigator": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800", accent: "bg-blue-600" },
                  "Apollo.io": { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-800", accent: "bg-violet-600" },
                };
                const pColors = platformColors[platform.name] || { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-800", accent: "bg-gray-600" };

                return (
                  <div key={platform.name} className={`rounded-xl border ${pColors.border} overflow-hidden`}>
                    {/* Platform header */}
                    <div className={`${pColors.bg} px-6 py-4 flex items-center justify-between`}>
                      <h3 className={`font-semibold text-lg ${pColors.text}`}>{platform.name}</h3>
                    </div>

                    {/* Filters */}
                    <div className="bg-white divide-y divide-gray-100">
                      {platform.filters.map((filter) => {
                        const filterKey = `${platform.name}:${filter.facet}`;
                        const isCopied = copiedFilter === filterKey;
                        return (
                          <div key={filter.facet} className="px-6 py-3 flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-700 mb-1">{filter.facet}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {filter.values.map((value, vi) => (
                                  <span key={vi} className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${pColors.bg} ${pColors.text}`}>
                                    {value}
                                  </span>
                                ))}
                              </div>
                              {filter.notes && (
                                <p className="text-xs text-gray-500 mt-1">{filter.notes}</p>
                              )}
                            </div>
                            <button
                              onClick={() => copyFilterValue(filterKey, filter.values.join(", "))}
                              className="flex-shrink-0 mt-0.5 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                              title="Copy values"
                            >
                              {isCopied ? (
                                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              )}
                            </button>
                          </div>
                        );
                      })}

                      {/* Boolean search */}
                      {platform.booleanSearch && (
                        <div className="px-6 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">
                              {platform.name === "Google X-Ray Search" ? "X-Ray Search Strings" : "Boolean Search"}
                            </span>
                            <button
                              onClick={() => copyFilterValue(`${platform.name}:boolean`, platform.booleanSearch!)}
                              className="text-xs px-3 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors flex items-center gap-1"
                            >
                              {copiedFilter === `${platform.name}:boolean` ? (
                                <><svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                              ) : (
                                <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                              )}
                            </button>
                          </div>
                          <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                            {platform.booleanSearch}
                          </pre>
                        </div>
                      )}

                      {/* Tips */}
                      {platform.tips && platform.tips.length > 0 && (
                        <div className="px-6 py-3 bg-gray-50">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Tips</div>
                          <ul className="space-y-1">
                            {platform.tips.map((tip, ti) => (
                              <li key={ti} className="text-sm text-gray-600 flex items-start gap-2">
                                <span className="text-gray-400 mt-0.5 flex-shrink-0">&#8226;</span>
                                {tip}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {ConfirmModalElement}
    </div>
  );
}
