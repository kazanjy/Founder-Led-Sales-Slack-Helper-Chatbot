"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

/**
 * A saved sourcing search.
 *
 * This URL is the point of the whole persistence change: a search is
 * addressable, so it can be bookmarked, pasted to whoever else is
 * hiring, and returned to next week with the leads and the enrichment
 * already paid for still on it.
 *
 * Triage state lives on each lead because "I looked at this person and
 * passed" is the most valuable thing a saved search remembers — without
 * it, coming back means re-reading the same rejects.
 */

interface Employer {
  company: string;
  start: string | null;
  end: string | null;
  current: boolean;
  months: number | null;
  titles: string[];
}

interface Lead {
  id: string;
  apolloId: string;
  firstName: string | null;
  lastNameMasked: string | null;
  title: string | null;
  organizationName: string | null;
  via: string[] | null;
  enrichedAt: string | null;
  name: string | null;
  linkedinUrl: string | null;
  headline: string | null;
  employers: Employer[] | null;
  shortStints: number | null;
  tenureVerdict: "clean" | "pattern" | "disaster" | null;
  status: "new" | "shortlisted" | "passed";
}

interface SavedSearch {
  id: string;
  name: string;
  roleType: string;
  companies: Array<{ name: string; tier: number; apolloOrgId: string }>;
  titles: string[];
  locations: string[];
  modes: string[];
  yoeMin: number | null;
  yoeMax: number | null;
  totalFound: number;
  lastRunAt: string;
}

const VERDICT_STYLE: Record<string, string> = {
  clean: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  pattern: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  disaster: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "Undecided" },
  { key: "shortlisted", label: "Shortlist" },
  { key: "passed", label: "Passed" },
] as const;

function monthsLabel(m: number | null): string {
  if (m === null) return "—";
  if (m < 12) return `${m}mo`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y}y ${r}mo` : `${y}y`;
}

export default function SavedSourcingSearchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [search, setSearch] = useState<SavedSearch | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["key"]>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sourcing/searches/${id}`);
      if (res.status === 404) {
        setError("That search doesn't exist, or belongs to another account.");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setSearch(data.search);
      setLeads(data.leads);
      setNameDraft(data.search.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = leads.filter((l) => (tab === "all" ? true : l.status === tab));
  const unenrichedSelected = [...selected].filter(
    (leadId) => !leads.find((l) => l.id === leadId)?.enrichedAt
  ).length;

  const enrichSelected = async () => {
    const leadIds = [...selected];
    if (leadIds.length === 0) return setError("Tick some leads first.");
    setBusy("enrich");
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/sourcing/searches/${id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enrichment failed");
      const byId = new Map<string, Lead>((data.leads as Lead[]).map((l) => [l.id, l]));
      setLeads((prev) => prev.map((l) => byId.get(l.id) || l));
      setNote(
        `Enriched ${data.enriched}.` +
          (data.skipped ? ` ${data.skipped} were already enriched — no credits spent on those.` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrichment failed");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (leadId: string, status: Lead["status"]) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
    const res = await fetch(`/api/sourcing/searches/${id}/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError("Couldn't save that decision.");
      load();
    }
  };

  const rerun = async () => {
    setBusy("rerun");
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/sourcing/searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rerun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-run failed");
      await load();
      setNote(
        data.newLeads > 0
          ? `${data.newLeads} new ${data.newLeads === 1 ? "person" : "people"} since last time.`
          : "No new people since last time."
      );
      if (data.partialError) setError(`Partial — ${data.partialError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setBusy(null);
    }
  };

  const saveName = async () => {
    setRenaming(false);
    await fetch(`/api/sourcing/searches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameDraft }),
    });
    load();
  };

  const remove = async () => {
    if (!confirm("Delete this search and its leads? Enrichment already paid for will be lost.")) return;
    await fetch(`/api/sourcing/searches/${id}`, { method: "DELETE" });
    router.push("/sourcing");
  };

  const assess = (linkedinUrl: string) => {
    try {
      sessionStorage.setItem("sourcing-linkedin-url", linkedinUrl);
    } catch {
      /* blocked storage — the field just starts empty */
    }
    window.open("/candidate-fit", "_blank");
  };

  const toggle = (leadId: string) => {
    const next = new Set(selected);
    if (next.has(leadId)) next.delete(leadId);
    else next.add(leadId);
    setSelected(next);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <SalesNavBar />
        <div className="max-w-7xl mx-auto px-6 py-8 text-sm text-gray-500">Loading…</div>
      </div>
    );
  }

  if (!search) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <SalesNavBar />
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
          <Link href="/sourcing" className="text-sm text-purple-600 hover:underline">
            ← Back to sourcing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link href="/sourcing" className="text-xs text-gray-500 hover:underline">
          ← All searches
        </Link>

        <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {renaming ? (
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setRenaming(false);
                }}
                autoFocus
                className="text-2xl font-bold bg-transparent border-b border-purple-500 text-gray-900 dark:text-gray-100 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => setRenaming(true)}
                title="Click to rename"
                className="text-2xl font-bold text-gray-900 dark:text-gray-100 cursor-text"
              >
                {search.name}
              </h1>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {leads.length} saved of {search.totalFound.toLocaleString()} matched · last run{" "}
              {new Date(search.lastRunAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={rerun}
              disabled={busy !== null}
              title="Re-run against Apollo. Existing leads keep their enrichment and triage."
              className="px-3 py-2 text-sm font-medium rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === "rerun" ? "Re-running…" : "Re-run"}
            </button>
            <button
              onClick={enrichSelected}
              disabled={busy !== null || selected.size === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {busy === "enrich"
                ? "Enriching…"
                : `Enrich ${selected.size || ""}${unenrichedSelected !== selected.size && selected.size ? ` (${unenrichedSelected} new)` : ""}`}
            </button>
            <button
              onClick={remove}
              className="px-2 py-2 text-sm text-gray-400 hover:text-red-600"
              title="Delete search"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Criteria, so a search returned to in a month still explains itself */}
        <div className="mb-5 flex flex-wrap gap-1.5 text-xs">
          {search.companies.map((c) => (
            <span key={c.apolloOrgId} className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
              {c.name}
            </span>
          ))}
          {search.locations.map((l) => (
            <span key={l} className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              {l}
            </span>
          ))}
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {search.modes.includes("alumni") && search.modes.includes("current")
              ? "Previously + currently"
              : search.modes.includes("alumni")
                ? "Previously there"
                : "Currently there"}
          </span>
          {(search.yoeMin != null || search.yoeMax != null) && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              {search.yoeMin ?? 0}–{search.yoeMax ?? "∞"} yrs
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {note && (
          <div className="mb-4 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 text-sm text-purple-700 dark:text-purple-300">
            {note}
          </div>
        )}

        <div className="mb-3 flex gap-1">
          {STATUS_TABS.map((t) => {
            const count = t.key === "all" ? leads.length : leads.filter((l) => l.status === t.key).length;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  tab === t.key
                    ? "bg-purple-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                }`}
              >
                {t.label} {count}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {shown.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Nothing in this tab.</p>
          )}
          {shown.map((l) => (
            <div
              key={l.id}
              className={`border rounded-lg p-3 ${
                l.status === "passed"
                  ? "border-gray-200 dark:border-gray-700 opacity-50"
                  : l.status === "shortlisted"
                    ? "border-green-300 dark:border-green-700 bg-green-50/40 dark:bg-green-900/10"
                    : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(l.id)}
                  onChange={() => toggle(l.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {l.name || `${l.firstName || ""} ${l.lastNameMasked || ""}`.trim()}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {l.title}
                      {l.organizationName ? ` · ${l.organizationName}` : ""}
                    </span>
                    {(l.via || []).map((v) => (
                      <span
                        key={v}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                          v === "alumni"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        }`}
                      >
                        {v === "alumni" ? "ALUMNI" : "CURRENT"}
                      </span>
                    ))}
                    {l.tenureVerdict && (
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${VERDICT_STYLE[l.tenureVerdict]}`}>
                        {l.tenureVerdict === "clean"
                          ? "Tenure clean"
                          : `${l.shortStints} short stints — ${l.tenureVerdict}`}
                      </span>
                    )}
                    {l.enrichedAt && !l.linkedinUrl && (
                      <span className="text-[10px] text-gray-400">No Apollo match</span>
                    )}
                  </div>

                  {l.employers && l.employers.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {l.employers.map((c, i) => (
                        <div key={`${c.company}-${i}`} className="flex flex-wrap gap-x-2 text-xs text-gray-600 dark:text-gray-400">
                          <span className="font-medium text-gray-800 dark:text-gray-200">{c.company}</span>
                          <span>{monthsLabel(c.months)}</span>
                          <span className="text-gray-400 dark:text-gray-500">
                            {c.start || "?"} → {c.current ? "now" : c.end || "?"}
                          </span>
                          {c.titles.length > 1 && (
                            <span className="text-green-700 dark:text-green-400">
                              {c.titles.length} titles (promoted)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    {l.linkedinUrl && (
                      <>
                        <a href={l.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:underline">
                          LinkedIn ↗
                        </a>
                        <button onClick={() => assess(l.linkedinUrl!)} className="text-purple-600 dark:text-purple-400 hover:underline">
                          Assess →
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setStatus(l.id, l.status === "shortlisted" ? "new" : "shortlisted")}
                      className={l.status === "shortlisted" ? "text-green-700 dark:text-green-400 font-medium" : "text-gray-500 hover:underline"}
                    >
                      {l.status === "shortlisted" ? "★ Shortlisted" : "☆ Shortlist"}
                    </button>
                    <button
                      onClick={() => setStatus(l.id, l.status === "passed" ? "new" : "passed")}
                      className={l.status === "passed" ? "text-gray-600 font-medium" : "text-gray-500 hover:underline"}
                    >
                      {l.status === "passed" ? "Passed — undo" : "Pass"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
