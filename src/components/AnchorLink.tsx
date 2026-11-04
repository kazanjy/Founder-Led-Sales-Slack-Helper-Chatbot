"use client";

import { useState } from "react";

/**
 * A "#" that appears on hover beside a section heading, copies a deep
 * link to that section, and scrolls to it.
 *
 * Extracted from CoachingFramework so the coaching page's own sections
 * (Notes, Call Transcript) can use the same affordance rather than a
 * second implementation that drifts from it.
 *
 * The heading it sits in must carry the same `id`, plus `group` (so the
 * hover reveal works) and a `scroll-mt-*` (so a sticky header doesn't
 * cover the thing we just scrolled to):
 *
 *   <h3 id="notes" className="group scroll-mt-24 ... flex items-center gap-2">
 *     Notes
 *     <AnchorLink id="notes" label="Notes" />
 *   </h3>
 */
export default function AnchorLink({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <a
      href={`#${id}`}
      aria-label={`Copy link to ${label}`}
      title={`Copy link to ${label}`}
      onClick={(e) => {
        e.preventDefault();
        const { origin, pathname, search } = window.location;
        // replaceState rather than letting the browser follow the href:
        // the hash lands in the URL without pushing a history entry, and
        // without Next treating it as a navigation.
        window.history.replaceState(null, "", `${pathname}${search}#${id}`);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        // search is kept because on the coaching page it carries
        // ?session=<id> — the hash alone would open someone else's
        // most recent session and scroll to the wrong Notes.
        navigator.clipboard
          ?.writeText(`${origin}${pathname}${search}#${id}`)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => {
            /* hash + scroll already happened; clipboard is the bonus */
          });
      }}
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity font-normal normal-case tracking-normal text-gray-400 hover:text-purple-600 dark:hover:text-purple-300"
    >
      {copied ? (
        <span className="text-[11px] text-green-600 dark:text-green-300">Copied</span>
      ) : (
        "#"
      )}
    </a>
  );
}
