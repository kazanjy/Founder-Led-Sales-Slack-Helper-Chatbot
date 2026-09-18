"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface CalendarPickerEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  meetingUrl: string | null;
  eventUrl: string | null;
  description: string | null;
  inferredCompany: { name: string; url: string } | null;
  attendees: Array<{ email: string; name: string | null; external: boolean }>;
  /** Populated when at least one external attendee's email domain
   *  matches an existing (non-dismissed) deal the user already owns —
   *  drives the "Already has deal" affordance in the picker so the
   *  founder doesn't double-create. */
  existingDeal: { id: string; name: string; stage: string; status: string } | null;
}

interface FetchResult {
  events: CalendarPickerEvent[];
  windowDays: { back: number; forward: number };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function isSameDay(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export default function CalendarEventPicker({
  onAddEvents,
}: {
  onAddEvents: (events: CalendarPickerEvent[]) => void;
}) {
  const [lookback, setLookback] = useState(30);
  const [lookforward, setLookforward] = useState(30);
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from the generic error state so we can render a Google-
  // Calendar-flavored Connect CTA when the API responds 403 (not
  // connected) instead of a flat red error sentence.
  const [needsConnect, setNeedsConnect] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (back: number, forward: number) => {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    try {
      const res = await fetch(`/api/deals/calendar-search?lookback=${back}&lookforward=${forward}`);
      if (res.status === 403) {
        setNeedsConnect(true);
        setData({ events: [], windowDays: { back, forward } });
        return;
      }
      if (!res.ok) {
        setError("Couldn't load calendar events. Try again in a moment.");
        return;
      }
      const json: FetchResult = await res.json();
      setData(json);
    } catch {
      setError("Couldn't reach the calendar service.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + refetch on window-slider change. Slight debounce so
  // dragging the slider doesn't fire a fetch on every pixel.
  useEffect(() => {
    const t = window.setTimeout(() => { void load(lookback, lookforward); }, 250);
    return () => window.clearTimeout(t);
  }, [lookback, lookforward, load]);

  // Client-side substring filter — case-insensitive against title,
  // description, attendee email + display name. Empty query passes
  // every event through. Per the design we keep this purely local so
  // the input feels instant.
  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.events;
    return data.events.filter((ev) => {
      if (ev.title.toLowerCase().includes(q)) return true;
      if (ev.description && ev.description.toLowerCase().includes(q)) return true;
      for (const a of ev.attendees) {
        if (a.email.toLowerCase().includes(q)) return true;
        if (a.name && a.name.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [data, query]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Exclude events that already have a deal so "Select all visible"
  // doesn't bulk-attach duplicates to the new deal being created.
  // Users can still manually check those rows if they want to merge
  // a meeting onto a new parallel deal.
  const selectAllVisible = () => setSelectedIds(new Set(filteredEvents.filter((e) => !e.existingDeal).map((e) => e.id)));
  const selectNone = () => setSelectedIds(new Set());

  const handleAdd = () => {
    if (!data) return;
    const chosen = data.events.filter((e) => selectedIds.has(e.id));
    if (chosen.length === 0) return;
    onAddEvents(chosen);
    setSelectedIds(new Set());
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50/40 dark:bg-gray-800/40">
      {/* Window sliders — labels inline with the slider on the same
          row so the controls take half the vertical space. */}
      <div className="grid grid-cols-2 gap-3 mb-2">
        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <span className="whitespace-nowrap">Back: <span className="text-purple-600 dark:text-purple-300">{lookback}d</span></span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={lookback}
            onChange={(e) => setLookback(parseInt(e.target.value, 10))}
            className="flex-1 accent-purple-600"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <span className="whitespace-nowrap">Forward: <span className="text-purple-600 dark:text-purple-300">{lookforward}d</span></span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={lookforward}
            onChange={(e) => setLookforward(parseInt(e.target.value, 10))}
            className="flex-1 accent-purple-600"
          />
        </label>
      </div>

      {/* Search + toolbar + primary CTA in one row. Lifting the Add
          button into the toolbar puts it above the fold and removes
          the dedicated footer row below the list. */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, description, attendees…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={selectedIds.size === 0}
          className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add {selectedIds.size > 0 ? selectedIds.size : ""} event{selectedIds.size === 1 ? "" : "s"}
        </button>
      </div>

      {/* Selection actions + counts — compact single row above the list. */}
      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
        <div className="flex items-center gap-2">
          <button onClick={selectAllVisible} className="text-purple-600 hover:underline font-medium">Select all visible</button>
          <span className="text-gray-300">·</span>
          <button onClick={selectNone} className="hover:underline font-medium">Select none</button>
        </div>
        <span>
          {data ? `${filteredEvents.length} of ${data.events.length} events` : ""}
          {selectedIds.size > 0 && <span className="text-purple-600 dark:text-purple-300 font-medium"> · {selectedIds.size} selected</span>}
        </span>
      </div>

      {/* Body — denser rows: drop the description preview line so each
          event is just the title row + attendees row. Description still
          surfaces via title attribute on hover for power users. */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 max-h-72 overflow-y-auto">
        {loading && !data ? (
          <div className="text-center py-8 text-sm text-gray-400">Loading calendar…</div>
        ) : needsConnect ? (
          <div className="px-6 py-8 flex flex-col items-center text-center gap-3">
            <p className="text-sm text-gray-700 dark:text-gray-200 max-w-sm">
              Connect Google Calendar to search your meetings here and turn them into deals in one click.
            </p>
            <a
              href="/api/auth/google?returnTo=/deals?new=1"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Connect Google Calendar
            </a>
            <p className="text-[11px] text-gray-400">
              You&rsquo;ll come back to this New Deal flow when the connection finishes.
            </p>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-red-600">{error}</div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {query.trim() ? `No events match "${query}"` : "No matching meetings in this window."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredEvents.map((ev) => {
              const selected = selectedIds.has(ev.id);
              return (
                <li key={ev.id}>
                  <label
                    className={`flex items-start gap-2 px-3 py-1.5 cursor-pointer transition-colors ${selected ? "bg-purple-50 dark:bg-purple-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/60"}`}
                    title={ev.description || undefined}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(ev.id)}
                      className="mt-1 w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
                          {fmtDate(ev.startsAt)}
                          {isSameDay(ev.startsAt) && <span className="text-purple-600 dark:text-purple-300"> · today</span>}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ev.title}</span>
                        {ev.inferredCompany && (
                          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{ev.inferredCompany.name}</span>
                        )}
                        {ev.existingDeal && (
                          <a
                            href={`/deals/${ev.existingDeal.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                            title={`Existing deal — stage: ${ev.existingDeal.stage}, status: ${ev.existingDeal.status}`}
                          >
                            ⚠ {ev.existingDeal.name} ↗
                          </a>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {ev.attendees.slice(0, 3).map((a) => a.name || a.email).join(", ")}
                        {ev.attendees.length > 3 && ` +${ev.attendees.length - 3}`}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
