"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "reference report" slot on a metric tile.
 *
 * Metrics get argued about in sessions because nobody can find where
 * the number came from. This keeps the source — the Looker board, the
 * Sheet, the Stripe view — one click from the number it produced, and
 * one click from the clipboard so it can be pasted into a thread.
 *
 * Sized for a tile, not a form: when a link is set this is a single
 * small row, and when it isn't the affordance is a faint "+ Reference"
 * that only appears to someone who can edit. The editor is inline
 * rather than a modal so setting a link never loses the tile's context.
 */

export interface MetricReferenceLinkProps {
  url?: string | null;
  label?: string | null;
  canEdit: boolean;
  onSave: (url: string | null, label: string | null) => void;
}

/** Falls back to the hostname so a bare URL still reads as something. */
function displayLabel(url: string, label?: string | null): string {
  if (label?.trim()) return label.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function MetricReferenceLink({
  url,
  label,
  canEdit,
  onSave,
}: MetricReferenceLinkProps) {
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url || "");
  const [draftLabel, setDraftLabel] = useState(label || "");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftUrl(url || "");
    setDraftLabel(label || "");
  }, [url, label]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission).
      // Select the text instead so it can still be copied by hand rather
      // than the button appearing to do nothing.
      const el = document.createElement("input");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        /* genuinely unavailable — the link is still clickable */
      }
      document.body.removeChild(el);
    }
  };

  const commit = () => {
    const u = draftUrl.trim();
    onSave(u || null, u ? draftLabel.trim() || null : null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="w-full mb-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraftUrl(url || "");
              setDraftLabel(label || "");
              setEditing(false);
            }
          }}
          placeholder="Paste the report URL…"
          className="w-full text-[10px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="Label (optional)"
          className="w-full text-[10px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={commit}
            className="text-[10px] px-2 py-0.5 rounded bg-purple-600 text-white hover:bg-purple-700"
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraftUrl(url || "");
              setDraftLabel(label || "");
              setEditing(false);
            }}
            className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline"
          >
            Cancel
          </button>
          {url && (
            <button
              onClick={() => {
                onSave(null, null);
                setDraftUrl("");
                setDraftLabel("");
                setEditing(false);
              }}
              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!url) {
    if (!canEdit) return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        // Faint until hovered: an empty slot on every tile shouldn't
        // compete with the number the tile exists to show.
        className="mb-1.5 text-[10px] text-gray-300 dark:text-gray-600 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
      >
        + Reference report
      </button>
    );
  }

  return (
    <div
      className="mb-1.5 flex items-center justify-center gap-1 max-w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className="inline-flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 hover:underline truncate max-w-[9rem]"
      >
        <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5"
          />
        </svg>
        <span className="truncate">{displayLabel(url, label)}</span>
      </a>
      <button
        onClick={copy}
        title={copied ? "Copied" : "Copy link"}
        aria-label={copied ? "Copied" : "Copy link"}
        className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {copied ? (
          <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
      </button>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          title="Edit reference"
          aria-label="Edit reference"
          className="shrink-0 p-0.5 rounded text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
