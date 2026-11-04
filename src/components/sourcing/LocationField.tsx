"use client";

import { useEffect, useRef, useState } from "react";
import { suggestLocations, type LocationOption } from "@/lib/sourcing/locations";

/**
 * Location picker: pills plus a typeahead.
 *
 * The suggestions come from a local vocabulary rather than an API,
 * because Apollo has no public location-suggest endpoint. That has one
 * user-visible consequence worth designing around: the list is not
 * exhaustive, so free text must remain possible. Pressing Enter on
 * something the list has never heard of adds it as typed and Apollo is
 * given the chance to match it.
 *
 * The reason the list exists at all is that an unrecognised location
 * string doesn't error — Apollo just returns nobody. Offering the
 * spellings Apollo knows makes the common case correct without making
 * the uncommon case impossible.
 */

const KIND_LABEL: Record<LocationOption["kind"], string> = {
  metro: "Metro",
  state: "State",
  country: "Country",
};

export interface LocationFieldProps {
  values: string[];
  onChange: (next: string[]) => void;
  label?: string;
  hint?: string;
}

export default function LocationField({
  values,
  onChange,
  label = "Locations",
  hint = "Where the person lives — not their employer's head office.",
}: LocationFieldProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const suggestions = suggestLocations(draft, values);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlight in range as the list shrinks under typing.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, suggestions.length - 1)));
  }, [suggestions.length]);

  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
    setOpen(false);
    setHighlight(0);
  };

  const remove = (value: string) => onChange(values.filter((v) => v !== value));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // The highlighted suggestion wins, but typing something the list
      // has never heard of and pressing Enter still adds it verbatim.
      if (open && suggestions[highlight]) add(suggestions[highlight].value);
      else add(draft);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      remove(values[values.length - 1]);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 text-sm rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700"
            >
              {v}
              <button
                onClick={() => remove(v)}
                aria-label={`Remove ${v}`}
                className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/20"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={values.length === 0 ? "United States, San Francisco, CA…" : "Add another…"}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />

      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {suggestions.map((s, i) => (
            <li key={s.value}>
              <button
                // mousedown, not click: the input's blur would otherwise
                // close the list before the click landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s.value);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-3 ${
                  i === highlight
                    ? "bg-purple-50 dark:bg-purple-900/30 text-gray-900 dark:text-gray-100"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                <span>{s.value}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {KIND_LABEL[s.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {hint} Anything not in the list can still be typed — press Enter to add it.
      </p>
    </div>
  );
}
