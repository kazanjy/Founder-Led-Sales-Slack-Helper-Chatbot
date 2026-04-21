"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import { DEAL_STAGES, DEAL_STATUSES, getStageInfo, getStatusInfo } from "@/lib/deals/constants";

interface Deal {
  id: string;
  name: string;
  companyName: string;
  stage: string;
  status: string;
  lastAnalysis: string | null;
  lastAnalyzedAt: string | null;
  updatedAt: string;
  createdAt: string;
  _count: { entries: number; participants: number };
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffDay = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDay < 1) return "today";
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DealsPage() {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [newDealName, setNewDealName] = useState("");
  const [newDealCompany, setNewDealCompany] = useState("");
  const [creating, setCreating] = useState(false);
  const [importedCall, setImportedCall] = useState<{
    title?: string;
    summary?: string;
    transcript?: string;
    recordingUrl?: string;
    date?: string;
    attendees?: Array<{ name: string; email?: string; title?: string; company?: string }>;
  } | null>(null);

  const inferCompanyFromEmail = (email: string | undefined): string | null => {
    if (!email) return null;
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return null;
    const commonDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com"];
    if (commonDomains.includes(domain)) return null;
    // Extract the main part, capitalize
    const core = domain.split(".")[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  };

  const loadDeals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/deals");
      if (res.ok) {
        const data = await res.json();
        setDeals(data.deals || []);
      }
    } catch (error) {
      console.error("Failed to load deals:", error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = "Deals - Mikey";
    loadDeals();
  }, [loadDeals]);

  const createDeal = async () => {
    if (!newDealName.trim() || !newDealCompany.trim()) return;
    setCreating(true);
    try {
      // 1) Create the deal
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDealName.trim(),
          companyName: newDealCompany.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to create deal");
      const { deal } = await res.json();

      // 2) If there's imported call data, create a timeline entry + participants
      if (importedCall) {
        const headerLines: string[] = [];
        if (importedCall.date) {
          headerLines.push(`Call Date: ${new Date(importedCall.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
        }
        if (importedCall.attendees?.length) {
          const formatted = importedCall.attendees.map((a) => {
            const parts = [a.name];
            if (a.title) parts[0] += `, ${a.title}`;
            if (a.company) parts[0] += ` @ ${a.company}`;
            if (a.email) parts.push(a.email);
            return parts.join(" — ");
          });
          headerLines.push(`Attendees:\n${formatted.map((f) => `  - ${f}`).join("\n")}`);
        }
        const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
        const summaryPart = importedCall.summary ? `## Summary\n\n${importedCall.summary}\n\n` : "";
        const transcriptPart = importedCall.transcript ? `## Transcript\n\n${importedCall.transcript}` : "";

        // Create timeline entry
        await fetch(`/api/deals/${deal.id}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "call_transcript",
            title: importedCall.title,
            content: header + summaryPart + transcriptPart,
            sourceUrl: importedCall.recordingUrl,
            entryDate: importedCall.date ? new Date(importedCall.date).toISOString() : undefined,
          }),
        });

        // Create participants from attendees
        if (importedCall.attendees?.length) {
          for (const a of importedCall.attendees) {
            if (!a.name) continue;
            await fetch(`/api/deals/${deal.id}/participants`, {
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
        }
      }

      router.push(`/deals/${deal.id}`);
    } catch (error) {
      console.error("Failed to create deal:", error);
      setCreating(false);
    }
  };

  const resetNewDealForm = () => {
    setShowNewDeal(false);
    setNewDealName("");
    setNewDealCompany("");
    setImportedCall(null);
  };

  const filteredDeals = deals.filter((d) => {
    if (stageFilter !== "all" && d.stage !== stageFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">💼 Deals</h1>
            <p className="text-gray-600 text-sm">
              Track your active sales opportunities — timeline of calls, emails, notes, and AI-powered next actions.
            </p>
          </div>
          <button
            onClick={() => setShowNewDeal(true)}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-medium text-sm shadow hover:shadow-md transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Deal
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap text-sm">
          <span className="text-gray-500 text-xs font-medium uppercase tracking-wider">Stage:</span>
          <button
            onClick={() => setStageFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            All
          </button>
          {DEAL_STAGES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStageFilter(s.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === s.value ? "bg-gray-900 text-white" : `${s.color} hover:opacity-80`}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mb-6 flex-wrap text-sm">
          <span className="text-gray-500 text-xs font-medium uppercase tracking-wider">Status:</span>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            All
          </button>
          {DEAL_STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === s.value ? "bg-gray-900 text-white" : `${s.color} hover:opacity-80`}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Deal grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="h-5 w-48 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
            <div className="text-5xl mb-3">💼</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {deals.length === 0 ? "No deals yet" : "No deals match these filters"}
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              {deals.length === 0 ? "Create your first deal to start tracking engagement artifacts and get AI-powered next actions." : "Try adjusting the stage or status filters above."}
            </p>
            {deals.length === 0 && (
              <button
                onClick={() => setShowNewDeal(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-medium text-sm"
              >
                + Create Your First Deal
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredDeals.map((deal) => {
              const stageInfo = getStageInfo(deal.stage);
              const statusInfo = getStatusInfo(deal.status);
              return (
                <button
                  key={deal.id}
                  onClick={() => router.push(`/deals/${deal.id}`)}
                  className="text-left bg-white border border-gray-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">{deal.name}</h3>
                      <p className="text-sm text-gray-500 truncate">{deal.companyName}</p>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${stageInfo.color}`}>
                      {stageInfo.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-3">
                    <span className={`px-2 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
                    <span>· {deal._count.entries} {deal._count.entries === 1 ? "entry" : "entries"}</span>
                    <span>· {deal._count.participants} {deal._count.participants === 1 ? "person" : "people"}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">
                    Updated {formatRelative(deal.updatedAt)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* New Deal Modal */}
      {showNewDeal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetNewDealForm(); }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">New Deal</h3>
            <p className="text-sm text-gray-500 mb-4">
              Create a deal to track a sales opportunity. Import a call to bootstrap it automatically, or create manually.
            </p>

            {/* Import from Meeting Recorder */}
            <div className="mb-4">
              <MeetingRecorderPanel
                defaultCollapsed={false}
                onSelectCall={(data) => {
                  setImportedCall(data);
                  // Infer company name from attendees (external domain)
                  if (!newDealCompany.trim()) {
                    const externalAttendee = data.attendees?.find((a) => {
                      const company = inferCompanyFromEmail(a.email);
                      return company != null;
                    });
                    const inferredCompany = externalAttendee?.company
                      || inferCompanyFromEmail(externalAttendee?.email)
                      || "";
                    if (inferredCompany) setNewDealCompany(inferredCompany);
                  }
                  // Suggest deal name from the call title or company + call type
                  if (!newDealName.trim() && data.title) {
                    setNewDealName(data.title);
                  }
                }}
              />
            </div>

            {importedCall && (
              <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-purple-900">
                    ✓ Call imported: {importedCall.title || "Untitled"}
                  </p>
                  <button
                    onClick={() => setImportedCall(null)}
                    className="text-xs text-purple-600 hover:text-purple-800"
                  >
                    Remove
                  </button>
                </div>
                <p className="text-xs text-purple-700">
                  {importedCall.attendees?.length || 0} attendee{(importedCall.attendees?.length || 0) === 1 ? "" : "s"} · {importedCall.transcript ? `${importedCall.transcript.length.toLocaleString()} char transcript` : "no transcript"}
                </p>
                <p className="text-xs text-purple-600 mt-1">
                  This call will be added as the first timeline entry, and attendees will be added as participants.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={newDealCompany}
                  onChange={(e) => setNewDealCompany(e.target.value)}
                  placeholder="e.g., Visana Health"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal Name</label>
                <input
                  type="text"
                  value={newDealName}
                  onChange={(e) => setNewDealName(e.target.value)}
                  placeholder="e.g., Visana - Enterprise Deal"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => { if (e.key === "Enter") createDeal(); }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetNewDealForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={createDeal}
                disabled={!newDealName.trim() || !newDealCompany.trim() || creating}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : importedCall ? "Create Deal from Call" : "Create Deal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
