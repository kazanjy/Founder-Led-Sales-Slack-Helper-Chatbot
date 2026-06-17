"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DealRow = {
  id: string;
  name: string;
  companyName: string;
  stage: string;
  status: string;
};

/**
 * Global Cmd/Ctrl+K command palette. Mounts at the root layout so
 * the keyboard shortcut is available from every page in the app.
 *
 * On open:
 *  - Lazy-fetches /api/deals if we haven't yet this session. Cached
 *    on the component instance so subsequent opens are instant.
 *  - Focuses the input.
 *  - Filters deals client-side by name + companyName as the user
 *    types.
 *  - Arrow keys + Enter to navigate / open; Escape closes.
 *
 * Unauthenticated visitors (landing page, etc.) get a 401 from the
 * /api/deals fetch — we degrade silently: the palette renders with
 * a "Sign in to search deals" hint instead of a result list, and the
 * keyboard shortcut still works without spamming console errors.
 */
export default function CmdKPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keybinding: Cmd+K on macOS, Ctrl+K elsewhere. Toggles the
  // palette. Suppress when an editable element is focused AND the
  // user is mid-composition (so we don't steal the shortcut from
  // browser native bindings inside form fields with their own Cmd+K
  // handlers — but we still want it to fire from normal page chrome).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lazy-load the deals list on first open. Cached for the session.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/deals")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setUnauthorized(true);
          setLoaded(true);
          return;
        }
        if (!res.ok) {
          setLoaded(true);
          return;
        }
        const data: { deals?: DealRow[] } = await res.json();
        if (cancelled) return;
        setDeals(
          (data.deals || []).map((d) => ({
            id: d.id,
            name: d.name,
            companyName: d.companyName,
            stage: d.stage,
            status: d.status,
          }))
        );
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  // Focus + reset on open. Don't clear query on close so re-opening
  // mid-search keeps the prior query (matches Notion's behavior).
  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Reset highlight whenever the query changes so the cursor doesn't
  // point past the end of a newly-shorter match list.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matches = q
    ? deals
        .filter(
          (d) => d.name.toLowerCase().includes(q) || d.companyName.toLowerCase().includes(q)
        )
        .slice(0, 12)
    : deals.slice(0, 12);

  const close = () => setOpen(false);

  const jumpToDeal = (id: string) => {
    close();
    router.push(`/deals/${id}`);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-gray-100 dark:border-gray-800">
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const pick = matches[highlight];
                if (pick) jumpToDeal(pick.id);
              }
            }}
            placeholder="Search deals by name or company…"
            className="flex-1 py-3 bg-transparent text-sm focus:outline-none placeholder-gray-400"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 rounded">
            ESC
          </kbd>
        </div>
        <div className="max-h-96 overflow-y-auto py-1">
          {unauthorized ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Sign in to search your deals.
            </div>
          ) : loading && deals.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400 italic">Loading deals…</div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400 italic">
              {q ? "No deals match." : "No deals yet."}
            </div>
          ) : (
            matches.map((d, idx) => (
              <button
                key={d.id}
                type="button"
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => jumpToDeal(d.id)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                  idx === highlight
                    ? "bg-purple-50 dark:bg-purple-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-gray-900 dark:text-gray-100">{d.name}</div>
                  <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {d.companyName} · {d.stage}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2 flex items-center justify-between text-[11px] text-gray-400">
          <span>↑ ↓ to navigate · ↵ to open · ESC to close</span>
          <Link href="/deals" onClick={close} className="text-purple-600 hover:underline">
            All deals →
          </Link>
        </div>
      </div>
    </div>
  );
}
