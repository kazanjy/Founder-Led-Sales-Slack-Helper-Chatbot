"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel, { SelectedCallData } from "@/components/MeetingRecorderPanel";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { useConfirmModal } from "@/components/useConfirmModal";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import {
  BUSINESS_CASE_TYPES,
  BC_TYPE_INFO,
  BusinessCaseType,
} from "@/lib/business-cases/constants";

/**
 * Business Cases suite — Discovery Summary · ROI Models · Business
 * Cases. Phase 1: only Discovery Summary is live; the other tabs are
 * scaffolded with descriptions. See business-cases-plan.md.
 *
 * Layout per live tab:
 *   1. Template card — the founder's reusable skeleton, generated from
 *      their playbook (narrative + discovery questions + first-call
 *      checklist), hand-editable, versioned by row.
 *   2. Generate card — the applet-side entry points: pick a live deal,
 *      pick recorded calls (MeetingRecorderPanel), and/or paste
 *      transcripts. (The 4th entry point lives on the deal page.)
 *   3. Instances list — generated artifacts, deal-linked ones first.
 * ?instance=<id> switches to a full editor view for one artifact.
 */

interface TemplateRow {
  id: string;
  type: string;
  content: string;
  createdAt: string;
}

interface InstanceRow {
  id: string;
  type: string;
  title: string;
  content: string;
  sourceContext: string | null;
  dealId: string | null;
  deal: { id: string; name: string; companyName: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface DealOption {
  id: string;
  name: string;
  companyName: string;
  status: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function BusinessCasesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm, ConfirmModalElement } = useConfirmModal();

  const tabParam = searchParams.get("tab");
  const activeTab: BusinessCaseType =
    (BUSINESS_CASE_TYPES as readonly string[]).includes(tabParam || "")
      ? (tabParam as BusinessCaseType)
      : "discovery_summary";
  const instanceParam = searchParams.get("instance");

  // ── Template state ────────────────────────────────────────────
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const [generatingTemplate, setGeneratingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // ── Generate-instance state ───────────────────────────────────
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [pickedCalls, setPickedCalls] = useState<SelectedCallData[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // ── Instances state ───────────────────────────────────────────
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(true);

  // ── Single-instance editor state ──────────────────────────────
  const [current, setCurrent] = useState<InstanceRow | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const info = BC_TYPE_INFO[activeTab];

  const loadTemplate = useCallback(async (type: BusinessCaseType) => {
    setTemplateLoaded(false);
    try {
      const res = await fetch(`/api/business-cases/templates?type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setTemplate(data.template || null);
      }
    } catch {
      /* card shows generate CTA */
    } finally {
      setTemplateLoaded(true);
    }
  }, []);

  const loadInstances = useCallback(async (type: BusinessCaseType) => {
    setLoadingInstances(true);
    try {
      const res = await fetch(`/api/business-cases/instances?type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setInstances(data.instances || []);
      }
    } catch {
      /* empty list */
    } finally {
      setLoadingInstances(false);
    }
  }, []);

  useEffect(() => {
    if (!info.available) return;
    loadTemplate(activeTab);
    loadInstances(activeTab);
  }, [activeTab, info.available, loadTemplate, loadInstances]);

  // Deal picker options — light list, potential/dismissed excluded.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/deals");
        if (res.ok) {
          const data = await res.json();
          setDeals(
            (data.deals || [])
              .filter((d: DealOption) => !["dismissed", "potential"].includes(d.status))
              .map((d: DealOption) => ({
                id: d.id,
                name: d.name,
                companyName: d.companyName,
                status: d.status,
              }))
          );
        }
      } catch {
        /* picker stays empty */
      }
    })();
  }, []);

  // Load the ?instance= target for the editor view.
  useEffect(() => {
    if (!instanceParam) {
      setCurrent(null);
      setEditingContent(false);
      return;
    }
    let cancelled = false;
    setLoadingCurrent(true);
    (async () => {
      try {
        const res = await fetch(`/api/business-cases/instances/${instanceParam}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCurrent(data.instance);
          setTitleDraft(data.instance?.title || "");
        }
      } catch {
        /* stays on list */
      } finally {
        if (!cancelled) setLoadingCurrent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceParam]);

  const openInstance = (id: string) => {
    router.push(`/business-cases?tab=${activeTab}&instance=${id}`);
  };
  const closeInstance = () => {
    router.push(`/business-cases?tab=${activeTab}`);
  };

  const handleGenerateTemplate = async () => {
    setGeneratingTemplate(true);
    try {
      const res = await fetch("/api/business-cases/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeTab, action: "generate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplate(data.template);
        setTemplateExpanded(true);
      }
    } catch {
      /* keep CTA */
    } finally {
      setGeneratingTemplate(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateDraft.trim()) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/business-cases/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeTab, action: "save", content: templateDraft }),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplate(data.template);
        setEditingTemplate(false);
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleGenerate = async () => {
    setGenerateError(null);
    if (!selectedDealId && pickedCalls.length === 0 && !pastedText.trim()) {
      setGenerateError("Pick a deal, select calls, or paste transcript content first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/business-cases/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          dealId: selectedDealId || undefined,
          title: customTitle.trim() || undefined,
          extraText: pastedText.trim() || undefined,
          transcripts: pickedCalls.map((c) => ({
            title: c.title,
            date: c.date,
            content: c.transcript || c.summary,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Generation failed (${res.status})`);
      }
      setPickedCalls([]);
      setPastedText("");
      setCustomTitle("");
      await loadInstances(activeTab);
      openInstance(data.instance.id);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveInstance = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/business-cases/instances/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleDraft,
          ...(editingContent ? { content: contentDraft } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrent(data.instance);
        setEditingContent(false);
        await loadInstances(activeTab);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteInstance = async () => {
    if (!current) return;
    const ok = await confirm({
      title: "Delete this artifact?",
      message:
        "This removes the document — and its copy on the deal timeline, if attached. This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/business-cases/instances/${current.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadInstances(activeTab);
      closeInstance();
    }
  };

  const handleCopy = async () => {
    if (!current) return;
    await copyMarkdownAsRichText(`# ${current.title}\n\n${current.content}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />
      {ConfirmModalElement}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            📈 Business Cases
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Turn your playbook and real call evidence into customer-facing documents —
            discovery summaries, ROI models, and full business cases.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          {BUSINESS_CASE_TYPES.map((t) => {
            const ti = BC_TYPE_INFO[t];
            const active = activeTab === t;
            return (
              <button
                key={t}
                onClick={() => router.push(`/business-cases?tab=${t}`)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-purple-600 text-purple-700 dark:text-purple-300"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {ti.emoji} {ti.plural}
                {!ti.available && (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!info.available ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <div className="text-4xl mb-3">{info.emoji}</div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {info.plural} are coming soon
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto">{info.description}</p>
          </div>
        ) : instanceParam ? (
          /* ── Single-instance editor view ─────────────────────── */
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            {loadingCurrent || !current ? (
              <div className="p-10 text-center text-sm text-gray-400">
                {loadingCurrent ? "Loading…" : "Artifact not found."}
              </div>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      onClick={closeInstance}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"
                    >
                      ← All {info.plural.toLowerCase()}
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ChatAboutButton
                        title={`${info.label}: ${current.title}`}
                        getContext={() =>
                          `# ${current.title}\n\n${current.content}\n\n---\n\n_This is a ${info.label} generated by Mikey. The user wants to discuss or refine it._`
                        }
                        label="Chat About This"
                        compact
                        primeOnly
                        mode="DIRECT"
                      />
                      <button
                        onClick={handleCopy}
                        className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium"
                      >
                        {copied ? "✓ Copied" : "Copy"}
                      </button>
                      {editingContent ? (
                        <>
                          <button
                            onClick={handleSaveInstance}
                            disabled={saving}
                            className="px-2.5 py-1 text-xs bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingContent(false)}
                            className="px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setContentDraft(current.content);
                            setEditingContent(true);
                          }}
                          className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={handleDeleteInstance}
                        className="px-2.5 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => {
                      if (titleDraft.trim() && titleDraft !== current.title) handleSaveInstance();
                    }}
                    className="w-full text-lg font-semibold bg-transparent text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-300 rounded px-1 -mx-1"
                  />
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    <span>{formatDate(current.createdAt)}</span>
                    {current.deal && (
                      <Link
                        href={`/deals/${current.deal.id}`}
                        className="text-purple-600 dark:text-purple-300 hover:underline"
                      >
                        💼 {current.deal.name}
                      </Link>
                    )}
                    {current.sourceContext && <span>· based on {current.sourceContext}</span>}
                    {current.dealId && (
                      <span className="text-gray-400">· synced to the deal timeline</span>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  {editingContent ? (
                    <textarea
                      value={contentDraft}
                      onChange={(e) => setContentDraft(e.target.value)}
                      rows={28}
                      className="w-full font-mono text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  ) : (
                    <div className="prose dark:prose-invert max-w-none prose-sm">
                      <ReactMarkdown>{current.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          /* ── Tab home: template + generate + instances ────────── */
          <div className="space-y-6">
            {/* Template card */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                  Your {info.label} Template
                </h2>
                <div className="flex items-center gap-2">
                  {template && !editingTemplate && (
                    <>
                      <button
                        onClick={() => setTemplateExpanded((v) => !v)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        {templateExpanded ? "Collapse" : "View"}
                      </button>
                      <button
                        onClick={() => {
                          setTemplateDraft(template.content);
                          setEditingTemplate(true);
                          setTemplateExpanded(true);
                        }}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        Edit
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleGenerateTemplate}
                    disabled={generatingTemplate || !templateLoaded}
                    className="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
                  >
                    {generatingTemplate
                      ? "Generating…"
                      : template
                        ? "Regenerate from playbook"
                        : "Generate from my playbook"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Built from your sales narrative, discovery questions, and first-call
                checklist — so every filled summary demonstrates coverage of what YOU
                probe for. Edit it until the structure is yours
                {template ? ` (last updated ${formatDate(template.createdAt)})` : ""}.
                {!template && templateLoaded && (
                  <span className="block mt-1 text-amber-600 dark:text-amber-400">
                    No template yet — generation will fall back to a generic discovery
                    structure until you create one.
                  </span>
                )}
              </p>
              {editingTemplate ? (
                <div className="space-y-2">
                  <textarea
                    value={templateDraft}
                    onChange={(e) => setTemplateDraft(e.target.value)}
                    rows={18}
                    className="w-full font-mono text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveTemplate}
                      disabled={savingTemplate}
                      className="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {savingTemplate ? "Saving…" : "Save template"}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(false)}
                      className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                template &&
                templateExpanded && (
                  <div className="prose dark:prose-invert max-w-none prose-sm border-t border-gray-100 dark:border-gray-700 pt-3">
                    <ReactMarkdown>{template.content}</ReactMarkdown>
                  </div>
                )
              )}
            </div>

            {/* Generate card */}
            <div className="bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-1">
                Create a {info.label}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Attach a live deal (uses its full timeline as evidence), pick recorded
                calls, and/or paste transcripts — combine freely.
              </p>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Deal</label>
                  <select
                    value={selectedDealId}
                    onChange={(e) => setSelectedDealId(e.target.value)}
                    className="px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 max-w-xs"
                  >
                    <option value="">No deal — ad hoc</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300 ml-2">
                    Title <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Auto-generated if blank"
                    className="px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 flex-1 min-w-[200px]"
                  />
                </div>

                {pickedCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pickedCalls.map((c, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full"
                      >
                        📞 {c.title || `Call ${i + 1}`}
                        <button
                          onClick={() => setPickedCalls((prev) => prev.filter((_, j) => j !== i))}
                          className="hover:text-purple-900 dark:hover:text-purple-100"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <MeetingRecorderPanel
                  defaultCollapsed
                  onSelectCalls={(calls) => setPickedCalls((prev) => [...prev, ...calls])}
                  onSelectCall={(call) => setPickedCalls((prev) => [...prev, call])}
                />

                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={4}
                  placeholder="Or paste call transcripts / notes / email threads here…"
                  className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                />

                {generateError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{generateError}</p>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating — this can take a minute…
                    </>
                  ) : (
                    <>{info.emoji} Generate {info.label}</>
                  )}
                </button>
              </div>
            </div>

            {/* Instances list */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
                Your {info.plural}
              </h2>
              {loadingInstances ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : instances.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                  None yet — generate your first one above, or from any deal page.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {instances.map((inst) => (
                    <li key={inst.id}>
                      <button
                        onClick={() => openInstance(inst.id)}
                        className="w-full text-left py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <span className="text-lg">{info.emoji}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {inst.title}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(inst.createdAt)}
                            {inst.deal ? ` · 💼 ${inst.deal.name}` : " · ad hoc"}
                            {inst.sourceContext ? ` · ${inst.sourceContext}` : ""}
                          </span>
                        </span>
                        <span className="text-gray-300 dark:text-gray-600">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BusinessCasesPage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-900" />}
    >
      <BusinessCasesPageInner />
    </Suspense>
  );
}
