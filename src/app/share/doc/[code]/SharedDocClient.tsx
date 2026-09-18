"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SharedDocument {
  documentType: string;
  title: string;
  content: string;
  createdAt: string;
}

interface NarrativeSections {
  narrative: string;
  description1000w: string;
  description100w: string;
  description50w: string;
  description25w: string;
  answersByCategory: Record<string, Array<{
    questionId: string;
    globalOrder: number;
    question: string;
    answer: string;
  }>> | null;
}

const typeLabels: Record<string, string> = {
  salesNarrative: "Sales Narrative",
  discoveryQuestions: "Discovery Questions",
  firstCallChecklist: "First Call Checklist",
  preCallPlanning: "Pre-Call Checklist",
  preCallResearch: "Pre-Call Research",
  callReview: "Call Review Scorecard",
  adCreator: "Ad Creator",
  objectionLibrary: "Objection Library",
  // Added alongside the share-route whitelist fix so the new
  // document types render with a real heading instead of the raw
  // slug. All seven flow through the generic ReactMarkdown render
  // path further down — no special-case rendering needed.
  hiringProfile: "AE Hiring Profile",
  salesLeaderProfile: "Sales Leader Profile",
  preHireAssessment: "Pre-Hire Assessment",
  icp: "Ideal Customer Profile",
  callRecap: "Call Recap Email",
  salesMetrics: "Sales Metrics",
  salesMotion: "Sales Motion",
};

const validTabs = ["qa", "narrative", "1000w", "100w", "50w", "25w"] as const;
type Tab = typeof validTabs[number];

function getTabFromHash(): Tab {
  if (typeof window === "undefined") return "narrative";
  const hash = window.location.hash.replace("#", "");
  return validTabs.includes(hash as Tab) ? (hash as Tab) : "narrative";
}

function getWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface SharedDocClientProps {
  code: string;
}

export default function SharedDocClient({ code }: SharedDocClientProps) {
  const [doc, setDoc] = useState<SharedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(getTabFromHash);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Sync hash on popstate
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
    async function loadDoc() {
      try {
        const res = await fetch(`/api/share/doc/${code}`);
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setDoc(data.document);
        }
      } catch {
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    }

    loadDoc();
  }, [code]);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <img src="/mikey-avatar.png" alt="Mikey" className="w-16 h-16 rounded-xl mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Oops!</h1>
          <p className="text-gray-500 dark:text-gray-400">{error || "Document not found"}</p>
          <a href="/" className="inline-block mt-4 text-blue-600 hover:underline">Go to Mikey</a>
        </div>
      </div>
    );
  }

  const typeLabel = typeLabels[doc.documentType] || doc.documentType;

  // Try to parse structured narrative sections
  let sections: NarrativeSections | null = null;
  if (doc.documentType === "salesNarrative") {
    try {
      const parsed = JSON.parse(doc.content);
      if (parsed && typeof parsed.narrative === "string") {
        sections = parsed;
      }
    } catch {
      // Legacy share — content is plain markdown, show as full narrative only
    }
  }

  // If it's a salesNarrative with structured sections, render the tabbed view
  if (doc.documentType === "salesNarrative" && sections) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-800">
        <SharedHeader typeLabel={typeLabel} />

        <main className="max-w-[800px] mx-auto px-6 py-8">
          <div className="mb-6">
            <span className="inline-block px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium mb-3">
              {typeLabel}
            </span>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{doc.title}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Shared {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
            <TabButton tab="qa" label="Q&A Inputs" activeTab={activeTab} onSwitch={switchTab} />
            <TabButton tab="narrative" label="Full Narrative" activeTab={activeTab} onSwitch={switchTab} />
            {sections.description1000w && (
              <TabButton tab="1000w" label="1000 Words" activeTab={activeTab} onSwitch={switchTab} />
            )}
            <TabButton tab="100w" label="100 Words" activeTab={activeTab} onSwitch={switchTab} />
            <TabButton tab="50w" label="50 Words" activeTab={activeTab} onSwitch={switchTab} />
            <TabButton tab="25w" label="25 Words" activeTab={activeTab} onSwitch={switchTab} />
          </div>

          {/* Q&A Tab */}
          {activeTab === "qa" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Questionnaire Answers</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">The inputs used to generate this narrative</p>
              </div>
              <div className="p-6 space-y-6">
                {sections.answersByCategory ? (
                  ["Product", "Problem", "Solution", "Proof", "Business"].map((category) => {
                    const answers = sections!.answersByCategory?.[category];
                    if (!answers || answers.length === 0) return null;

                    const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
                      Product: { bg: "bg-indigo-50 dark:bg-indigo-900/30", border: "border-indigo-200 dark:border-indigo-800", text: "text-indigo-700 dark:text-indigo-300" },
                      Problem: { bg: "bg-red-50 dark:bg-red-900/30", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-300" },
                      Solution: { bg: "bg-blue-50 dark:bg-blue-900/30", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-300" },
                      Proof: { bg: "bg-green-50 dark:bg-green-900/30", border: "border-green-200 dark:border-green-800", text: "text-green-700 dark:text-green-300" },
                      Business: { bg: "bg-purple-50 dark:bg-purple-900/30", border: "border-purple-200 dark:border-purple-800", text: "text-purple-700 dark:text-purple-300" },
                    };
                    const colors = categoryColors[category] || { bg: "bg-gray-50 dark:bg-gray-700/40", border: "border-gray-200 dark:border-gray-700", text: "text-gray-700 dark:text-gray-200" };

                    return (
                      <div key={category} className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
                        <h3 className={`font-semibold ${colors.text} mb-3`}>{category}</h3>
                        <div className="space-y-4">
                          {answers.map((qa) => (
                            <div key={qa.questionId} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-100 dark:border-gray-700">
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Q{qa.globalOrder}: {qa.question}</p>
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

          {/* Narrative tabs */}
          {activeTab === "narrative" && (
            <NarrativeSection
              title="Full Sales Narrative"
              subtitle={`${getWordCount(sections.narrative)} words - Complete version`}
              content={sections.narrative}
              field="narrative"
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          )}
          {activeTab === "1000w" && sections.description1000w && (
            <NarrativeSection
              title="1000-Word Version"
              subtitle={`${getWordCount(sections.description1000w)} words - Condensed version`}
              content={sections.description1000w}
              field="1000w"
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          )}
          {activeTab === "100w" && (
            <NarrativeSection
              title="100-Word Version"
              subtitle={`${getWordCount(sections.description100w)} words - Elevator pitch`}
              content={sections.description100w}
              field="100w"
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          )}
          {activeTab === "50w" && (
            <NarrativeSection
              title="50-Word Version"
              subtitle={`${getWordCount(sections.description50w)} words - Brief pitch`}
              content={sections.description50w}
              field="50w"
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          )}
          {activeTab === "25w" && (
            <NarrativeSection
              title="25-Word Version"
              subtitle={`${getWordCount(sections.description25w)} words - One-liner`}
              content={sections.description25w}
              field="25w"
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          )}

          <SharedFooter typeLabel={typeLabel} />
        </main>
      </div>
    );
  }

  // Default: plain document view (non-narrative types, or legacy narrative shares)
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <SharedHeader typeLabel={typeLabel} />

      <main className="max-w-[800px] mx-auto px-6 py-8">
        <div className="mb-6">
          <span className="inline-block px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium mb-3">
            {typeLabel}
          </span>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{doc.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Shared {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>

        <div className="prose dark:prose-invert max-w-none prose-p:my-4 prose-headings:mt-8 prose-headings:mb-4 prose-ul:my-4 prose-ol:my-4 prose-li:my-1 prose-hr:my-8 text-[17px] prose-h2:mt-10 prose-h3:mt-8">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>

        <SharedFooter typeLabel={typeLabel} />
      </main>
    </div>
  );
}

/* ─── Shared sub-components ─── */

function SharedHeader({ typeLabel }: { typeLabel: string }) {
  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sticky top-0 z-10">
      <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 flex-shrink-0">
          <img src="/mikey-avatar.png" alt="Mikey" className="w-8 h-8 rounded-lg" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">Mikey</span>
        </a>
        <span className="text-sm text-gray-500 dark:text-gray-400 text-center hidden sm:block">
          Shared {typeLabel} from Mikey, the Founder-Led Sales assistant.
        </span>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
        >
          <img src="/mikey-avatar.png" alt="Mikey" className="w-5 h-5 rounded" />
          Try Mikey
        </a>
      </div>
    </header>
  );
}

function SharedFooter({ typeLabel }: { typeLabel: string }) {
  return (
    <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 text-center">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        This {typeLabel.toLowerCase()} was created with Mikey, the Founder-Led Sales assistant.
      </p>
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <img src="/mikey-avatar.png" alt="Mikey" className="w-5 h-5 rounded" />
        Try Mikey
      </a>
    </div>
  );
}

function TabButton({ tab, label, activeTab, onSwitch }: { tab: Tab; label: string; activeTab: Tab; onSwitch: (t: Tab) => void }) {
  return (
    <button
      onClick={() => onSwitch(tab)}
      className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
        activeTab === tab
          ? "border-purple-600 text-purple-600"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

function NarrativeSection({
  title,
  subtitle,
  content,
  field,
  copiedField,
  onCopy,
}: {
  title: string;
  subtitle: string;
  content: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <button
          onClick={() => onCopy(content, field)}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
        >
          {copiedField === field ? (
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
      <div className="p-6 prose max-w-none prose-p:my-4 prose-headings:mt-8 prose-headings:mb-4 prose-ul:my-4 prose-ol:my-4 prose-li:my-1 prose-hr:my-8 text-[17px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
