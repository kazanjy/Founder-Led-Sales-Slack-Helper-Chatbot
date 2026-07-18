"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SalesNavBar from "@/components/SalesNavBar";
import { copyMarkdownAsRichText } from "@/lib/clipboard";

/**
 * Quotes & Success Stories — extract customer proof points from call
 * transcripts once, publish them into six mediums (attributed + blind
 * testimonials / success stories / case studies). Phase 1: pasted
 * sources, web format.
 */

interface CollectionSummary {
  id: string;
  title: string;
  customerName: string | null;
  sourceCount: number;
  proofPointCount: number;
  assetCount: number;
  updatedAt: string;
}

interface SourceCall {
  id: string;
  title: string;
  date: string | null;
  origin: "paste" | "recorder" | "deal";
  content: string;
}

interface ProofPoint {
  id: string;
  claim: string;
  quote: string;
  speaker: string | null;
  role: string | null;
  date: string | null;
  metric: string | null;
  narrativePillar: string | null;
  arc: "single" | "before_after" | "progression";
  themeMatch: boolean;
  included: boolean;
}

interface SuccessAsset {
  id: string;
  medium: string;
  format: string;
  content: string;
  createdAt: string;
}

interface CollectionDetail {
  id: string;
  title: string;
  customerName: string | null;
  themeFocus: string | null;
  sources: SourceCall[];
  proofPoints: ProofPoint[] | null;
  proofPointsAt: string | null;
  assets: SuccessAsset[];
}

const MEDIUMS: Array<{ key: string; label: string; blind: boolean; hint: string }> = [
  { key: "testimonial", label: "Testimonial", blind: false, hint: "Attributed first-person quote block" },
  { key: "blind_testimonial", label: "Blind testimonial", blind: true, hint: "Anonymized quote, role descriptor" },
  { key: "success_story", label: "Success story", blind: false, hint: "2–4 paragraphs, named" },
  { key: "blind_success_story", label: "Blind success story", blind: true, hint: "2–4 paragraphs, anonymized" },
  { key: "case_study", label: "Case study", blind: false, hint: "Long form: situation → results" },
  { key: "blind_case_study", label: "Blind case study", blind: true, hint: "Long form, anonymized" },
];

const MEDIUM_LABELS: Record<string, string> = Object.fromEntries(
  MEDIUMS.map((m) => [m.key, m.label])
);

const ARC_LABELS: Record<string, string> = {
  single: "point in time",
  before_after: "before → after",
  progression: "progression",
};

function Spinner({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export default function SuccessStoriesPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-collection form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCustomer, setNewCustomer] = useState("");
  const [creating, setCreating] = useState(false);

  // Add-source form
  const [srcTitle, setSrcTitle] = useState("");
  const [srcDate, setSrcDate] = useState("");
  const [srcContent, setSrcContent] = useState("");
  const [savingSources, setSavingSources] = useState(false);

  // Theme focus
  const [themeDraft, setThemeDraft] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);

  const [extracting, setExtracting] = useState(false);
  const [generatingMedium, setGeneratingMedium] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadList = useCallback(async (selectFirst = false) => {
    try {
      const res = await fetch("/api/success-stories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setCollections(data.collections || []);
      if (selectFirst && data.collections?.length && !selectedId) {
        setSelectedId(data.collections[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collections");
    } finally {
      setLoadingList(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await fetch(`/api/success-stories/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const c = data.collection;
      setDetail({
        id: c.id,
        title: c.title,
        customerName: c.customerName,
        themeFocus: c.themeFocus,
        sources: Array.isArray(c.sources) ? c.sources : [],
        proofPoints: Array.isArray(c.proofPoints) ? c.proofPoints : null,
        proofPointsAt: c.proofPointsAt,
        assets: c.assets || [],
      });
      setThemeDraft(c.themeFocus || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const createCollection = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/success-stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), customerName: newCustomer.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setNewTitle("");
      setNewCustomer("");
      setShowNewForm(false);
      await loadList();
      setSelectedId(data.collection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create collection");
    } finally {
      setCreating(false);
    }
  };

  const patchCollection = async (patch: Record<string, unknown>) => {
    if (!detail) return false;
    const res = await fetch(`/api/success-stories/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Failed to save");
      return false;
    }
    return true;
  };

  const addSource = async () => {
    if (!detail || !srcContent.trim() || savingSources) return;
    setSavingSources(true);
    setError(null);
    const next: SourceCall[] = [
      ...detail.sources,
      {
        id: crypto.randomUUID(),
        title: srcTitle.trim() || `Call ${detail.sources.length + 1}`,
        date: /^\d{4}-\d{2}-\d{2}$/.test(srcDate) ? srcDate : null,
        origin: "paste",
        content: srcContent,
      },
    ];
    if (await patchCollection({ sources: next })) {
      setDetail({ ...detail, sources: next });
      setSrcTitle("");
      setSrcDate("");
      setSrcContent("");
      loadList();
    }
    setSavingSources(false);
  };

  const removeSource = async (sourceId: string) => {
    if (!detail) return;
    const next = detail.sources.filter((s) => s.id !== sourceId);
    if (await patchCollection({ sources: next })) {
      setDetail({ ...detail, sources: next });
      loadList();
    }
  };

  const saveTheme = async () => {
    if (!detail || savingTheme) return;
    if ((detail.themeFocus || "") === themeDraft.trim()) return;
    setSavingTheme(true);
    if (await patchCollection({ themeFocus: themeDraft })) {
      setDetail({ ...detail, themeFocus: themeDraft.trim() || null });
    }
    setSavingTheme(false);
  };

  const runExtraction = async () => {
    if (!detail || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/success-stories/${detail.id}/extract`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setDetail({
        ...detail,
        proofPoints: data.proofPoints || [],
        proofPointsAt: new Date().toISOString(),
      });
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const savePoints = async (points: ProofPoint[]) => {
    if (!detail) return;
    setDetail({ ...detail, proofPoints: points });
    await patchCollection({ proofPoints: points });
  };

  const toggleIncluded = (pointId: string) => {
    if (!detail?.proofPoints) return;
    savePoints(
      detail.proofPoints.map((p) =>
        p.id === pointId ? { ...p, included: !p.included } : p
      )
    );
  };

  const editClaim = (pointId: string, claim: string) => {
    if (!detail?.proofPoints) return;
    const current = detail.proofPoints.find((p) => p.id === pointId);
    if (!current || current.claim === claim.trim() || !claim.trim()) return;
    savePoints(
      detail.proofPoints.map((p) => (p.id === pointId ? { ...p, claim: claim.trim() } : p))
    );
  };

  const generateAsset = async (mediumKey: string) => {
    if (!detail || generatingMedium) return;
    setGeneratingMedium(mediumKey);
    setError(null);
    try {
      const res = await fetch(`/api/success-stories/${detail.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medium: mediumKey, format: "web" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      await loadDetail(detail.id);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingMedium(null);
    }
  };

  const deleteAsset = async (assetId: string) => {
    if (!detail) return;
    const res = await fetch(`/api/success-stories/${detail.id}/assets/${assetId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDetail({ ...detail, assets: detail.assets.filter((a) => a.id !== assetId) });
      loadList();
    }
  };

  const deleteCollection = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete "${detail.title}" and all its generated assets?`)) return;
    const res = await fetch(`/api/success-stories/${detail.id}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedId(null);
      setDetail(null);
      loadList(true);
    }
  };

  const copyAsset = async (asset: SuccessAsset) => {
    const ok = await copyMarkdownAsRichText(asset.content);
    if (ok) {
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const includedCount = detail?.proofPoints?.filter((p) => p.included !== false).length || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">🌟 Quotes &amp; Success Stories</h1>
          <p className="text-sm text-gray-600 mt-1">
            Paste customer calls, extract proof points aligned with your sales narrative, then
            publish them as testimonials, success stories, and case studies — attributed or blind.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start justify-between gap-3">
            <span className="min-w-0 break-words">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-5">
          {/* ── Left rail: collections ── */}
          <div className="md:w-64 flex-shrink-0">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">Collections</h2>
                <button
                  onClick={() => setShowNewForm((v) => !v)}
                  className="text-xs px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700"
                >
                  + New
                </button>
              </div>
              {showNewForm && (
                <div className="mb-3 p-2 rounded border border-purple-200 bg-purple-50 space-y-2">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Title — e.g. Acme success"
                    className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 bg-white"
                    autoFocus
                  />
                  <input
                    value={newCustomer}
                    onChange={(e) => setNewCustomer(e.target.value)}
                    placeholder="Customer name (optional)"
                    className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 bg-white"
                    onKeyDown={(e) => e.key === "Enter" && createCollection()}
                  />
                  <button
                    onClick={createCollection}
                    disabled={!newTitle.trim() || creating}
                    className="w-full text-xs px-2 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {creating && <Spinner />}
                    Create collection
                  </button>
                </div>
              )}
              {loadingList ? (
                <div className="py-6 flex justify-center text-purple-600"><Spinner className="h-5 w-5" /></div>
              ) : collections.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">
                  No collections yet. One collection per customer — it grows as more calls land.
                </p>
              ) : (
                <div className="space-y-1">
                  {collections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-sm ${
                        selectedId === c.id
                          ? "bg-purple-100 text-purple-900 font-medium"
                          : "hover:bg-gray-100 text-gray-700"
                      }`}
                    >
                      <div className="truncate">{c.title}</div>
                      <div className="text-[11px] text-gray-500">
                        {c.sourceCount} call{c.sourceCount === 1 ? "" : "s"} · {c.proofPointCount} proof · {c.assetCount} asset{c.assetCount === 1 ? "" : "s"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Main panel ── */}
          <div className="flex-1 min-w-0 space-y-5">
            {!detail && !loadingDetail && (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
                {collections.length === 0
                  ? "Create a collection to get started — paste in a customer call and Mikey extracts the proof."
                  : "Select a collection."}
              </div>
            )}
            {loadingDetail && (
              <div className="bg-white rounded-lg border border-gray-200 p-8 flex justify-center text-purple-600">
                <Spinner className="h-6 w-6" />
              </div>
            )}

            {detail && !loadingDetail && (
              <>
                {/* Header */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">{detail.title}</h2>
                    {detail.customerName && (
                      <p className="text-sm text-gray-600">Customer: {detail.customerName}</p>
                    )}
                  </div>
                  <button
                    onClick={deleteCollection}
                    className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0"
                  >
                    Delete
                  </button>
                </div>

                {/* Sources */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">📞 Source calls</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    One call works — someone listing their wins. Multiple calls over time work
                    better: Mikey tracks the before → after arc.
                  </p>
                  {detail.sources.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {detail.sources.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-gray-200 bg-gray-50"
                        >
                          <div className="min-w-0 text-sm">
                            <span className="font-medium text-gray-800">{s.title}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              {s.date || "no date"} · {Math.round(s.content.length / 1000)}K chars
                            </span>
                          </div>
                          <button
                            onClick={() => removeSource(s.id)}
                            className="text-gray-400 hover:text-red-600 text-sm flex-shrink-0"
                            title="Remove call"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <input
                      value={srcTitle}
                      onChange={(e) => setSrcTitle(e.target.value)}
                      placeholder="Call title — e.g. QBR with Acme"
                      className="text-sm px-2.5 py-1.5 rounded border border-gray-300"
                    />
                    <input
                      type="date"
                      value={srcDate}
                      onChange={(e) => setSrcDate(e.target.value)}
                      className="text-sm px-2.5 py-1.5 rounded border border-gray-300 text-gray-700"
                    />
                  </div>
                  <textarea
                    value={srcContent}
                    onChange={(e) => setSrcContent(e.target.value)}
                    placeholder="Paste the call transcript or notes here…"
                    rows={5}
                    className="w-full text-sm px-2.5 py-1.5 rounded border border-gray-300 font-mono"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={addSource}
                      disabled={!srcContent.trim() || savingSources}
                      className="text-sm px-3 py-1.5 rounded bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {savingSources && <Spinner />}
                      + Add call
                    </button>
                  </div>
                </div>

                {/* Theme focus + extract */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">🎯 Theme focus <span className="font-normal text-gray-400">(optional)</span></h3>
                  <p className="text-xs text-gray-500 mb-2">
                    Steer the extraction — e.g. &ldquo;They talked about how fast implementation
                    was — focus on time-to-value and the CFO&rsquo;s reaction.&rdquo;
                  </p>
                  <textarea
                    value={themeDraft}
                    onChange={(e) => setThemeDraft(e.target.value)}
                    onBlur={saveTheme}
                    rows={2}
                    placeholder="What should the proof points emphasize?"
                    className="w-full text-sm px-2.5 py-1.5 rounded border border-gray-300"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={runExtraction}
                      disabled={extracting || detail.sources.length === 0}
                      className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 font-medium flex items-center gap-2"
                    >
                      {extracting ? <Spinner className="h-4 w-4" /> : "✨"}
                      {detail.proofPoints ? "Re-extract proof points" : "Extract proof points"}
                    </button>
                    {detail.proofPointsAt && !extracting && (
                      <span className="text-xs text-gray-500">
                        Last extracted {new Date(detail.proofPointsAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {extracting && (
                    <div className="mt-3 p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 flex items-center gap-3">
                      <Spinner className="h-6 w-6 text-purple-600 flex-shrink-0" />
                      <div className="text-sm min-w-0">
                        <div className="font-medium text-purple-900 flex items-center gap-1.5">
                          ✨ Mikey is mining the calls for customer proof
                          <span className="inline-flex">
                            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                            <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                            <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                          </span>
                        </div>
                        <div className="text-xs text-purple-700">
                          Reading every transcript for customer-voiced wins with verbatim quotes,
                          matching them to your sales narrative, and merging before → after arcs
                          across calls. Usually ~20–40 seconds.
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Proof points */}
                {detail.proofPoints && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">
                      💎 Proof points{" "}
                      <span className="font-normal text-gray-500">
                        ({includedCount} of {detail.proofPoints.length} included)
                      </span>
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Uncheck anything you don&rsquo;t want in the assets; click a claim to edit it.
                      Quotes are verbatim from the calls.
                    </p>
                    {detail.proofPoints.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No customer-voiced proof found in these calls. Proof needs the customer
                        saying it — try a call where they talk about results.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {detail.proofPoints.map((p) => (
                          <div
                            key={p.id}
                            className={`p-3 rounded-lg border ${
                              p.included !== false
                                ? "border-purple-200 bg-purple-50/50"
                                : "border-gray-200 bg-gray-50 opacity-60"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={p.included !== false}
                                onChange={() => toggleIncluded(p.id)}
                                className="mt-1 flex-shrink-0 accent-purple-600"
                              />
                              <div className="min-w-0 flex-1">
                                <input
                                  defaultValue={p.claim}
                                  onBlur={(e) => editClaim(p.id, e.target.value)}
                                  className="w-full text-sm font-medium text-gray-900 bg-transparent border border-transparent hover:border-gray-300 focus:border-purple-400 focus:bg-white rounded px-1 py-0.5 -mx-1"
                                />
                                <blockquote className="mt-1 text-sm text-gray-600 italic border-l-2 border-purple-300 pl-2">
                                  &ldquo;{p.quote}&rdquo;
                                </blockquote>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                  {p.metric && (
                                    <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">
                                      📊 {p.metric}
                                    </span>
                                  )}
                                  {p.narrativePillar && (
                                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                                      🧭 {p.narrativePillar}
                                    </span>
                                  )}
                                  {p.arc !== "single" && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                      📈 {ARC_LABELS[p.arc]}
                                    </span>
                                  )}
                                  {p.themeMatch && (
                                    <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                                      🎯 theme match
                                    </span>
                                  )}
                                  <span className="text-gray-500">
                                    {[p.speaker, p.role, p.date].filter(Boolean).join(" · ")}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Generate */}
                {detail.proofPoints && detail.proofPoints.length > 0 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">📝 Generate assets</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Web / blog format. Blind variants strip the customer&rsquo;s identity but keep
                      every metric. LinkedIn, tweet, and slide formats come next.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {MEDIUMS.map((m) => (
                        <button
                          key={m.key}
                          onClick={() => generateAsset(m.key)}
                          disabled={!!generatingMedium || includedCount === 0}
                          className={`text-left p-2.5 rounded-lg border text-sm disabled:opacity-50 ${
                            m.blind
                              ? "border-gray-300 bg-gray-50 hover:bg-gray-100"
                              : "border-purple-200 bg-purple-50 hover:bg-purple-100"
                          }`}
                        >
                          <div className="font-medium text-gray-900 flex items-center gap-1.5">
                            {generatingMedium === m.key && <Spinner className="h-3.5 w-3.5 text-purple-600" />}
                            {m.blind ? "🕶️" : "🏷️"} {m.label}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{m.hint}</div>
                        </button>
                      ))}
                    </div>
                    {generatingMedium && (
                      <div className="mt-3 p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 flex items-center gap-3">
                        <Spinner className="h-5 w-5 text-purple-600 flex-shrink-0" />
                        <div className="text-sm text-purple-900">
                          Writing the {MEDIUM_LABELS[generatingMedium]?.toLowerCase()} from your{" "}
                          {includedCount} included proof point{includedCount === 1 ? "" : "s"}…
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Asset library */}
                {detail.assets.length > 0 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      📚 Asset library <span className="font-normal text-gray-500">({detail.assets.length})</span>
                    </h3>
                    <div className="space-y-4">
                      {detail.assets.map((a) => (
                        <div key={a.id} className="rounded-lg border border-gray-200">
                          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                            <div className="text-xs text-gray-600">
                              <span className="font-medium text-gray-900">
                                {MEDIUM_LABELS[a.medium] || a.medium}
                              </span>{" "}
                              · web · {new Date(a.createdAt).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => copyAsset(a)}
                                className="text-xs px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-700"
                              >
                                {copiedId === a.id ? "✓ Copied" : "📋 Copy"}
                              </button>
                              <button
                                onClick={() => generateAsset(a.medium)}
                                disabled={!!generatingMedium}
                                className="text-xs px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 disabled:opacity-50"
                              >
                                🔄 Regenerate
                              </button>
                              <button
                                onClick={() => deleteAsset(a.id)}
                                className="text-xs text-gray-400 hover:text-red-600"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <div className="p-4 prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
