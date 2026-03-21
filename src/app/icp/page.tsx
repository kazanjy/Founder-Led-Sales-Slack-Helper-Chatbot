"use client";

import { useState, useEffect, Suspense } from "react";
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

interface IcpContent {
  sections: IcpSection[];
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

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");

  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Ideal Customer Profile - Mikey";
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

        if (versionId) {
          setVersion(data.version);
          setHasSalesNarrative(true);
        } else {
          setHasSalesNarrative(data.hasSalesNarrative !== false);
          if (data.hasIcp) {
            setVersion(data.version);
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
                  <Link href="/icp/history" className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    History
                  </Link>
                  <NewButtonDropdown onRegenerate={handleRegenerate} onUploadPDF={() => {}} generating={generating} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
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
      {ConfirmModalElement}
    </div>
  );
}
