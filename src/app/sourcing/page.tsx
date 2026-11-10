"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import LocationField from "@/components/sourcing/LocationField";

/**
 * Candidate sourcing — prototype.
 *
 * This page BUILDS a search. Running one saves it and navigates to
 * /sourcing/<id>, which is where results, enrichment and triage live —
 * so a search is addressable, bookmarkable, and still there next week
 * with the enrichment already paid for.
 *
 * The flow follows what Apollo can actually do, verified against the
 * live API:
 *
 *   1. Resolve company names to Apollo ids. Free.
 *   2. Search. Returns leads only — an id, a first name, a MASKED
 *      surname, a title. No dates, no history, no LinkedIn URL, so
 *      nothing can be judged at this stage.
 *   3. Enrich the ones worth spending on. This is where real work
 *      history appears and per-employer tenure can be computed.
 *
 * The default search mode is ALUMNI rather than current employees.
 * A founder's "where to look" tiers name small specialist orgs, and
 * Apollo indexes exactly one current AE at RevenueCat — the people who
 * left are the pool that matters.
 */

interface SavedSearchRow {
  id: string;
  name: string;
  roleType: string;
  totalFound: number;
  leadCount: number;
  enrichedCount: number;
  shortlistedCount: number;
  lastRunAt: string;
}

interface CompanyPill {
  name: string;
  /** Priority tier from the hiring profile. 0 = typed in by hand. */
  tier: number;
  group: string | null;
}

interface ResolvedOrg {
  query: string;
  id: string | null;
  matchedName: string | null;
  domain: string | null;
  confident: boolean;
  alternatives: Array<{ id: string; name: string; domain: string | null }>;
}

const DEFAULT_TITLES = "Account Executive, Founding Account Executive, Commercial Account Executive, Mid-Market Account Executive";

const TIER_STYLE: Record<number, string> = {
  0: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600",
  1: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700",
  2: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700",
  3: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
};

export default function SourcingPage() {
  const [companies, setCompanies] = useState<CompanyPill[]>([]);
  const [companyDraft, setCompanyDraft] = useState("");
  const [roleType, setRoleType] = useState<"AE" | "SDR" | "CSM">("AE");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [avoided, setAvoided] = useState<Array<{ name: string; reason: string | null }>>([]);
  const [titleText, setTitleText] = useState(DEFAULT_TITLES);
  const [locations, setLocations] = useState<string[]>(["United States"]);
  const [yoeMin, setYoeMin] = useState<string>("3");
  const [yoeMax, setYoeMax] = useState<string>("8");
  // Independent, not either/or: a founder can reasonably want both the
  // people who left an org and the ones still in the seat.
  const [wantAlumni, setWantAlumni] = useState(true);
  const [wantCurrent, setWantCurrent] = useState(false);

  const [resolved, setResolved] = useState<ResolvedOrg[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSearchRow[] | null>(null);
  const router = useRouter();

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/sourcing/searches");
      if (!res.ok) return;
      const data = await res.json();
      setSaved(data.searches || []);
    } catch {
      /* the list is a convenience; a failure here shouldn't block a search */
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const splitList = (s: string) =>
    s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  const addCompanies = (raw: string) => {
    const incoming = splitList(raw);
    if (incoming.length === 0) return;
    setCompanies((prev) => {
      const have = new Set(prev.map((c) => c.name.toLowerCase()));
      const added = incoming
        .filter((n) => !have.has(n.toLowerCase()))
        // Tier 0 marks a hand-typed company, so it reads differently
        // from one the hiring profile prioritised.
        .map((name) => ({ name, tier: 0, group: null }));
      return [...prev, ...added];
    });
    setCompanyDraft("");
  };

  const removeCompany = (name: string) =>
    setCompanies((prev) => prev.filter((c) => c.name !== name));

  const importFromProfile = async () => {
    setBusy("import");
    setError(null);
    setImportNote(null);
    try {
      const res = await fetch("/api/sourcing/import-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      const imported: CompanyPill[] = (data.companies || []).map(
        (c: { name: string; tier: number; group: string | null }) => ({
          name: c.name,
          tier: c.tier || 1,
          group: c.group ?? null,
        })
      );
      if (imported.length === 0) {
        setImportNote(
          `That ${roleType} profile doesn't name any companies to source from. Add some by hand, or regenerate the profile with a "where to look" section.`
        );
        return;
      }

      // Merge rather than replace: whatever was already on the board
      // was put there deliberately.
      setCompanies((prev) => {
        const have = new Set(prev.map((c) => c.name.toLowerCase()));
        return [...prev, ...imported.filter((c) => !have.has(c.name.toLowerCase()))];
      });
      setAvoided(data.avoid || []);
      const skipped = (data.avoid || []).length;
      setImportNote(
        `Imported ${imported.length} ${imported.length === 1 ? "company" : "companies"} from ${data.profile?.title || `your ${roleType} profile`}.` +
          (skipped ? ` ${skipped} on its avoid list were left out.` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const resolveCompanies = async () => {
    const names = companies.map((c) => c.name);
    if (names.length === 0) return setError("Add some company names first.");
    setBusy("resolve");
    setError(null);
    try {
      const res = await fetch("/api/sourcing/resolve-orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResolved(data.resolved);
      const picks: Record<string, string> = {};
      for (const r of data.resolved) if (r.id) picks[r.query] = r.id;
      setChosen(picks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve companies");
    } finally {
      setBusy(null);
    }
  };

  const runSearch = async () => {
    const picked = companies
      .map((c) => ({ ...c, apolloOrgId: chosen[c.name] }))
      .filter((c) => c.apolloOrgId);
    if (picked.length === 0) return setError("Resolve the companies first.");
    const modes = [wantAlumni && "alumni", wantCurrent && "current"].filter(Boolean);
    if (modes.length === 0) return setError("Tick Previously, Currently, or both.");

    setBusy("search");
    setError(null);
    try {
      const res = await fetch("/api/sourcing/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleType,
          companies: picked,
          modes,
          titles: splitList(titleText),
          locations,
          yoeMin: yoeMin ? Number(yoeMin) : undefined,
          yoeMax: yoeMax ? Number(yoeMax) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      // The saved search is the destination — results, enrichment and
      // triage all live at its own URL.
      router.push(`/sourcing/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Source Candidates</h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
              Prototype
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Find sellers who came out of the companies on your hiring profile&apos;s
            &ldquo;where to look&rdquo; list. Nothing here is saved yet — a refresh clears it.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Step 1 — companies */}
        <section className="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">1. Companies</h2>
            <div className="flex items-center gap-2">
              <select
                value={roleType}
                onChange={(e) => setRoleType(e.target.value as "AE" | "SDR" | "CSM")}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="AE">AE profile</option>
                <option value="SDR">SDR profile</option>
                <option value="CSM">CSM profile</option>
              </select>
              <button
                onClick={importFromProfile}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
                </svg>
                {busy === "import" ? "Importing…" : "Import from hiring profile"}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            The companies to hire FROM. Import pulls the &ldquo;where to look&rdquo; tiers
            straight out of your hiring profile. Resolving them against Apollo is free.
          </p>

          {companies.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {companies.map((c) => (
                <span
                  key={c.name}
                  title={
                    c.tier === 0
                      ? "Added by hand"
                      : `Tier ${c.tier}${c.group ? ` — ${c.group}` : ""}`
                  }
                  className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-sm rounded-full border ${TIER_STYLE[c.tier] || TIER_STYLE[0]}`}
                >
                  {c.tier > 0 && (
                    <span className="text-[10px] font-bold opacity-70">T{c.tier}</span>
                  )}
                  {c.name}
                  <button
                    onClick={() => removeCompany(c.name)}
                    aria-label={`Remove ${c.name}`}
                    className="ml-0.5 w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/20"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              <button
                onClick={() => setCompanies([])}
                className="text-xs text-gray-500 dark:text-gray-400 hover:underline self-center ml-1"
              >
                Clear all
              </button>
            </div>
          )}

          <input
            value={companyDraft}
            onChange={(e) => setCompanyDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds; comma too, so pasting a comma-separated list
              // from a profile splits into pills as you go.
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addCompanies(companyDraft);
              } else if (e.key === "Backspace" && !companyDraft && companies.length > 0) {
                removeCompany(companies[companies.length - 1].name);
              }
            }}
            onBlur={() => addCompanies(companyDraft)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/[,\n]/.test(text)) {
                e.preventDefault();
                addCompanies(text);
              }
            }}
            placeholder={
              companies.length === 0
                ? "Import from your profile, or type a company and press Enter"
                : "Add another…"
            }
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />

          {importNote && (
            <p className="mt-2 text-xs text-purple-700 dark:text-purple-300">{importNote}</p>
          )}
          {avoided.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                {avoided.length} on your profile&apos;s avoid list, not imported
              </summary>
              <ul className="mt-1 space-y-0.5">
                {avoided.map((a) => (
                  <li key={a.name} className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="line-through">{a.name}</span>
                    {a.reason ? ` — ${a.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            onClick={resolveCompanies}
            disabled={busy !== null || companies.length === 0}
            className="mt-3 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy === "resolve"
              ? "Resolving…"
              : `Resolve ${companies.length || ""} ${companies.length === 1 ? "company" : "companies"}`}
          </button>

          {resolved && (
            <div className="mt-4 space-y-2">
              {resolved.map((r) => (
                <div key={r.query} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{r.query}</span>
                  {r.id ? (
                    <>
                      <select
                        value={chosen[r.query] || ""}
                        onChange={(e) => setChosen({ ...chosen, [r.query]: e.target.value })}
                        className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      >
                        <option value={r.id}>
                          {r.matchedName} {r.domain ? `(${r.domain})` : ""}
                        </option>
                        {r.alternatives.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} {a.domain ? `(${a.domain})` : ""}
                          </option>
                        ))}
                        <option value="">— skip this one —</option>
                      </select>
                      {!r.confident && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          ambiguous — check this is the right company
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-red-600 dark:text-red-400">not found in Apollo</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Step 2 — search */}
        <section className="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">2. Who to look for</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400">Titles</span>
              <textarea
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                rows={2}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </label>
            <LocationField values={locations} onChange={setLocations} />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400">Years in sales, min</span>
              <input
                value={yoeMin}
                onChange={(e) => setYoeMin(e.target.value)}
                className="mt-1 w-24 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400">max</span>
              <input
                value={yoeMax}
                onChange={(e) => setYoeMax(e.target.value)}
                className="mt-1 w-24 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </label>
            <div>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Worked there</span>
              <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                {/* Independent toggles, not a segmented either/or — both
                    can be on, and each adds its own Apollo query. */}
                <button
                  onClick={() => setWantAlumni((v) => !v)}
                  aria-pressed={wantAlumni}
                  className={`px-3 py-2 text-sm inline-flex items-center gap-1.5 ${wantAlumni ? "bg-purple-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"}`}
                >
                  <span className={`w-3.5 h-3.5 rounded-sm border inline-flex items-center justify-center ${wantAlumni ? "bg-white border-white" : "border-gray-400"}`}>
                    {wantAlumni && (
                      <svg className="w-3 h-3 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  Previously
                </button>
                <button
                  onClick={() => setWantCurrent((v) => !v)}
                  aria-pressed={wantCurrent}
                  className={`px-3 py-2 text-sm inline-flex items-center gap-1.5 border-l border-gray-300 dark:border-gray-600 ${wantCurrent ? "bg-purple-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"}`}
                >
                  <span className={`w-3.5 h-3.5 rounded-sm border inline-flex items-center justify-center ${wantCurrent ? "bg-white border-white" : "border-gray-400"}`}>
                    {wantCurrent && (
                      <svg className="w-3 h-3 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  Currently
                </button>
              </div>
            </div>
            <button
              onClick={runSearch}
              disabled={busy !== null || !resolved}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 disabled:opacity-50"
            >
              {busy === "search" ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            <strong>Previously</strong> is usually the one you want: Apollo indexes a
            handful of current sellers at small specialist companies — one AE at
            RevenueCat, for instance — so the people who have moved on are the real
            pool. Tick both and each runs as its own search, costing one credit each;
            every lead is then tagged with how it was found.
          </p>
        </section>

        {/* Saved searches */}
        {saved && saved.length > 0 && (
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Saved searches</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Leads, enrichment and your shortlist decisions are kept. Re-opening one costs nothing.
            </p>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {saved.map((sv) => (
                <Link
                  key={sv.id}
                  href={`/sourcing/${sv.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 -mx-2 px-2 rounded"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{sv.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {sv.leadCount} lead{sv.leadCount === 1 ? "" : "s"}
                      {sv.enrichedCount > 0 ? ` · ${sv.enrichedCount} enriched` : ""}
                      {sv.shortlistedCount > 0 ? ` · ${sv.shortlistedCount} shortlisted` : ""}
                      {" · "}
                      {new Date(sv.lastRunAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 shrink-0">
                    {sv.roleType}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
