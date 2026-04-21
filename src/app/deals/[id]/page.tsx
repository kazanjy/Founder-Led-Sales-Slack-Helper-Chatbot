"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import { DEAL_STAGES, DEAL_STATUSES, PARTICIPANT_ROLES, ENTRY_TYPES, getStageInfo, getStatusInfo, getRoleInfo, getEntryTypeInfo } from "@/lib/deals/constants";

interface Participant {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  role: string;
  notes: string | null;
  pdlData: string | null;
  pdlEnrichedAt: string | null;
  createdAt: string;
}

interface TimelineEntry {
  id: string;
  type: string;
  title: string | null;
  content: string;
  sourceUrl: string | null;
  metadata: string | null;
  entryDate: string;
  createdAt: string;
}

interface Deal {
  id: string;
  name: string;
  companyName: string;
  companyUrl: string | null;
  stage: string;
  status: string;
  notes: string | null;
  lastAnalysis: string | null;
  lastAnalyzedAt: string | null;
  participants: Participant[];
  entries: TimelineEntry[];
  project: { id: string; name: string } | null;
}

function formatEntryDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEntryType, setNewEntryType] = useState<string>("note");
  const [newEntryContent, setNewEntryContent] = useState("");
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryUrl, setNewEntryUrl] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantTitle, setNewParticipantTitle] = useState("");
  const [newParticipantEmail, setNewParticipantEmail] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState("unknown");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState("");
  const [metaCompanyName, setMetaCompanyName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [enrichingPid, setEnrichingPid] = useState<string | null>(null);
  const [processingScreenshot, setProcessingScreenshot] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const loadDeal = useCallback(async () => {
    setLoading(true);
    try {
      const authRes = await fetch("/api/auth/me");
      const authData = await authRes.json();
      if (!authData.user) {
        router.push("/?error=not_logged_in");
        return;
      }
      const res = await fetch(`/api/deals/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDeal(data.deal);
      }
    } catch (error) {
      console.error("Failed to load deal:", error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    document.title = "Deal - Mikey";
    loadDeal();
  }, [loadDeal]);

  useEffect(() => {
    if (deal?.name) document.title = `${deal.name} - Mikey`;
  }, [deal?.name]);

  const updateDeal = async (updates: Partial<Deal>) => {
    const res = await fetch(`/api/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      setDeal((prev) => prev ? { ...prev, ...data.deal } : prev);
    }
  };

  const deleteDeal = async () => {
    if (!confirm("Delete this deal? All entries and participants will be deleted. This cannot be undone.")) return;
    await fetch(`/api/deals/${id}`, { method: "DELETE" });
    router.push("/deals");
  };

  const addEntry = async (entryData?: Partial<TimelineEntry>) => {
    const content = entryData?.content ?? newEntryContent;
    const type = entryData?.type ?? newEntryType;
    const title = entryData?.title ?? newEntryTitle;
    const sourceUrl = entryData?.sourceUrl ?? newEntryUrl;
    const entryDate = entryData?.entryDate;

    if (!content?.trim()) return;
    setAddingEntry(true);
    try {
      const res = await fetch(`/api/deals/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title || undefined,
          content,
          sourceUrl: sourceUrl || undefined,
          entryDate: entryDate || undefined,
        }),
      });
      if (res.ok) {
        setNewEntryContent("");
        setNewEntryTitle("");
        setNewEntryUrl("");
        setNewEntryType("note");
        await loadDeal();
      }
    } catch (error) {
      console.error("Failed to add entry:", error);
    }
    setAddingEntry(false);
  };

  const deleteEntry = async (entryId: string) => {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/deals/${id}/entries/${entryId}`, { method: "DELETE" });
    await loadDeal();
  };

  const addParticipant = async () => {
    if (!newParticipantName.trim()) return;
    await fetch(`/api/deals/${id}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newParticipantName.trim(),
        title: newParticipantTitle.trim() || undefined,
        email: newParticipantEmail.trim() || undefined,
        role: newParticipantRole,
      }),
    });
    setShowAddParticipant(false);
    setNewParticipantName("");
    setNewParticipantTitle("");
    setNewParticipantEmail("");
    setNewParticipantRole("unknown");
    await loadDeal();
  };

  const deleteParticipant = async (pid: string) => {
    if (!confirm("Remove this participant?")) return;
    await fetch(`/api/deals/${id}/participants/${pid}`, { method: "DELETE" });
    await loadDeal();
  };

  const updateParticipantRole = async (pid: string, role: string) => {
    await fetch(`/api/deals/${id}/participants/${pid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await loadDeal();
  };

  const analyzeDeal = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/deals/${id}/analyze`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDeal((prev) => prev ? { ...prev, lastAnalysis: data.analysis, lastAnalyzedAt: new Date().toISOString() } : prev);
        setShowAnalysis(true);
      }
    } catch (error) {
      console.error("Failed to analyze deal:", error);
    }
    setAnalyzing(false);
  };

  const enrichParticipant = async (pid: string) => {
    setEnrichingPid(pid);
    try {
      const res = await fetch(`/api/deals/${id}/participants/${pid}/enrich`, { method: "POST" });
      if (res.ok) {
        await loadDeal();
      } else {
        const data = await res.json();
        alert(data.error || "Enrichment failed");
      }
    } catch {
      alert("Enrichment failed");
    }
    setEnrichingPid(null);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        setProcessingScreenshot(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.readAsDataURL(file);
          });
          const res = await fetch(`/api/deals/${id}/screenshot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
          });
          if (res.ok) {
            const data = await res.json();
            await addEntry({
              type: "screenshot",
              title: data.title,
              content: data.content,
            });
          }
        } catch (error) {
          console.error("Failed to process screenshot:", error);
        }
        setProcessingScreenshot(false);
        return;
      }
    }
  };

  if (loading && !deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="h-8 w-64 bg-gray-100 rounded animate-pulse mb-4" />
          <div className="h-32 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
          <p className="text-gray-500">Deal not found.</p>
          <Link href="/deals" className="text-purple-600 hover:underline mt-2 inline-block">← Back to Deals</Link>
        </div>
      </div>
    );
  }

  const stageInfo = getStageInfo(deal.stage);
  const statusInfo = getStatusInfo(deal.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-4">
          <Link href="/deals" className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            All Deals
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {editingMeta ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold focus:ring-2 focus:ring-purple-500"
                    placeholder="Deal name"
                  />
                  <input
                    type="text"
                    value={metaCompanyName}
                    onChange={(e) => setMetaCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    placeholder="Company name"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await updateDeal({ name: metaName, companyName: metaCompanyName });
                        setEditingMeta(false);
                      }}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingMeta(false)} className="px-3 py-1.5 text-gray-600 text-sm hover:bg-gray-100 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setMetaName(deal.name); setMetaCompanyName(deal.companyName); setEditingMeta(true); }}
                  className="text-left group/title"
                >
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 group-hover/title:text-purple-700 transition-colors">{deal.name}</h1>
                  <p className="text-sm text-gray-500 mt-0.5">{deal.companyName}</p>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={deal.stage}
                onChange={(e) => updateDeal({ stage: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${stageInfo.color}`}
              >
                {DEAL_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select
                value={deal.status}
                onChange={(e) => updateDeal({ status: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${statusInfo.color}`}
              >
                {DEAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button
                onClick={analyzeDeal}
                disabled={analyzing || deal.entries.length === 0}
                className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-xs font-medium shadow hover:shadow-md disabled:opacity-50 flex items-center gap-1.5"
              >
                {analyzing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    Analyzing...
                  </>
                ) : "🧠 Analyze Deal"}
              </button>
              <button
                onClick={deleteDeal}
                className="text-xs text-gray-400 hover:text-red-600 px-2 py-1"
                title="Delete deal"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Analysis panel */}
        {deal.lastAnalysis && (
          <div className="bg-white border border-purple-200 rounded-xl mb-5">
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="w-full flex items-center justify-between px-5 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-purple-900">🧠 Deal Analysis</span>
                {deal.lastAnalyzedAt && (
                  <span className="text-xs text-gray-400">
                    · {new Date(deal.lastAnalyzedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAnalysis ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showAnalysis && (
              <div className="px-5 pb-5 border-t border-purple-100">
                <div className="prose prose-sm max-w-none text-gray-700 mt-3 whitespace-pre-wrap">
                  {deal.lastAnalysis}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={analyzeDeal}
                    disabled={analyzing}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
                  >
                    {analyzing ? "Analyzing..." : "↻ Re-analyze"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Participants sidebar */}
          <div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Participants ({deal.participants.length})</h3>
                <button
                  onClick={() => setShowAddParticipant(true)}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                >
                  + Add
                </button>
              </div>

              {showAddParticipant && (
                <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
                  <input type="text" value={newParticipantName} onChange={(e) => setNewParticipantName(e.target.value)} placeholder="Name" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" autoFocus />
                  <input type="text" value={newParticipantTitle} onChange={(e) => setNewParticipantTitle(e.target.value)} placeholder="Title (optional)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
                  <input type="email" value={newParticipantEmail} onChange={(e) => setNewParticipantEmail(e.target.value)} placeholder="Email (optional)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
                  <select value={newParticipantRole} onChange={(e) => setNewParticipantRole(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                    {PARTICIPANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addParticipant} disabled={!newParticipantName.trim()} className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-medium disabled:opacity-50">Add</button>
                    <button onClick={() => setShowAddParticipant(false)} className="px-2.5 py-1 text-gray-600 text-xs hover:bg-gray-100 rounded">Cancel</button>
                  </div>
                </div>
              )}

              {deal.participants.length === 0 && !showAddParticipant && (
                <p className="text-xs text-gray-400">No participants yet.</p>
              )}

              <div className="space-y-2">
                {deal.participants.map((p) => {
                  const roleInfo = getRoleInfo(p.role);
                  return (
                    <div key={p.id} className="border border-gray-200 rounded-lg p-2.5 group/p">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-gray-900 truncate">{p.name}</span>
                            {p.linkedinUrl && (
                              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 flex-shrink-0" title="LinkedIn">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>
                              </a>
                            )}
                          </div>
                          {p.title && <div className="text-xs text-gray-500 truncate">{p.title}{p.company ? ` @ ${p.company}` : ""}</div>}
                          {!p.title && p.company && <div className="text-xs text-gray-500 truncate">{p.company}</div>}
                          {p.email && <div className="text-xs text-gray-400 truncate">{p.email}</div>}
                        </div>
                        <button onClick={() => deleteParticipant(p.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover/p:opacity-100" title="Remove">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <select
                          value={p.role}
                          onChange={(e) => updateParticipantRole(p.id, e.target.value)}
                          className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${roleInfo.color}`}
                        >
                          {PARTICIPANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        {p.email && !p.pdlEnrichedAt && (
                          <button
                            onClick={() => enrichParticipant(p.id)}
                            disabled={enrichingPid === p.id}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 flex items-center gap-0.5"
                            title="Enrich via People Data Labs"
                          >
                            {enrichingPid === p.id ? (
                              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                            ) : "Enrich"}
                          </button>
                        )}
                        {p.pdlEnrichedAt && (
                          <span className="text-xs text-green-600" title={`Enriched ${new Date(p.pdlEnrichedAt).toLocaleDateString()}`}>✓</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Timeline + add entry */}
          <div>
            {/* Add entry input */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">New entry:</span>
                {ENTRY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setNewEntryType(t.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${newEntryType === t.value ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newEntryTitle}
                onChange={(e) => setNewEntryTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
              />
              <textarea
                value={newEntryContent}
                onChange={(e) => setNewEntryContent(e.target.value)}
                onPaste={handlePaste}
                placeholder="Paste content — call transcript, email, notes, or Cmd+V a screenshot..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y mb-2"
              />
              {processingScreenshot && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <svg className="animate-spin h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  <span className="text-xs text-purple-600">Extracting text from screenshot...</span>
                </div>
              )}
              <input
                type="url"
                value={newEntryUrl}
                onChange={(e) => setNewEntryUrl(e.target.value)}
                placeholder="Source URL (optional)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => addEntry()}
                  disabled={!newEntryContent.trim() || addingEntry}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                >
                  {addingEntry ? "Adding..." : "+ Add Entry"}
                </button>
              </div>
            </div>

            {/* Meeting Recorder import */}
            <div className="mb-5">
              <MeetingRecorderPanel
                defaultCollapsed={deal.entries.length > 0}
                onSelectCall={async (data) => {
                  // Build content with attendees header
                  const headerLines: string[] = [];
                  if (data.date) {
                    headerLines.push(`Call Date: ${new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
                  }
                  if (data.attendees?.length) {
                    const formatted = data.attendees.map((a) => {
                      const parts = [a.name];
                      if (a.title) parts[0] += `, ${a.title}`;
                      if (a.company) parts[0] += ` @ ${a.company}`;
                      if (a.email) parts.push(a.email);
                      return parts.join(" — ");
                    });
                    headerLines.push(`Attendees:\n${formatted.map((f) => `  - ${f}`).join("\n")}`);
                  }
                  const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
                  const summaryPart = data.summary ? `## Summary\n\n${data.summary}\n\n` : "";
                  const transcriptPart = data.transcript ? `## Transcript\n\n${data.transcript}` : "";

                  await addEntry({
                    type: "call_transcript",
                    title: data.title,
                    content: header + summaryPart + transcriptPart,
                    sourceUrl: data.recordingUrl,
                    entryDate: data.date ? new Date(data.date).toISOString() : undefined,
                  });

                  // Also add attendees as participants (deduplicated by name)
                  if (data.attendees?.length) {
                    const existingNames = new Set(deal.participants.map((p) => p.name.toLowerCase()));
                    for (const a of data.attendees) {
                      if (!a.name || existingNames.has(a.name.toLowerCase())) continue;
                      await fetch(`/api/deals/${id}/participants`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: a.name,
                          title: a.title,
                          company: a.company,
                          email: a.email,
                          role: "unknown",
                        }),
                      });
                    }
                    await loadDeal();
                  }
                }}
              />
            </div>

            {/* Timeline */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Timeline ({deal.entries.length})</h3>
              {deal.entries.length === 0 ? (
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center">
                  <p className="text-sm text-gray-500">No entries yet. Add one above or import a call from your meeting recorder.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deal.entries.map((entry) => {
                    const typeInfo = getEntryTypeInfo(entry.type);
                    return (
                      <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 group/e">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className="text-xs text-gray-400 font-medium">{formatEntryDate(entry.entryDate)}</span>
                              <span className="text-xs font-medium">{typeInfo.emoji} {typeInfo.label}</span>
                            </div>
                            {entry.title && <div className="font-semibold text-gray-900 text-sm">{entry.title}</div>}
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover/e:opacity-100 transition-opacity">
                            {entry.sourceUrl && (
                              <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600" title="Open source">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </a>
                            )}
                            <button onClick={() => deleteEntry(entry.id)} className="text-gray-400 hover:text-red-600" title="Delete">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                        <details>
                          <summary className="text-xs text-purple-600 cursor-pointer hover:text-purple-800">
                            {entry.content.length > 200 ? `Show full content (${entry.content.length.toLocaleString()} chars)` : "Show content"}
                          </summary>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap mt-2 pt-2 border-t border-gray-100">
                            {entry.content}
                          </div>
                        </details>
                        {entry.content.length <= 200 && (
                          <div className="text-sm text-gray-700 whitespace-pre-wrap mt-1">
                            {entry.content}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
