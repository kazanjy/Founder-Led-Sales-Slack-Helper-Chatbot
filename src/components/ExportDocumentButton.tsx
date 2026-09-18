"use client";

import { useEffect, useRef, useState } from "react";
import { exportMarkdownAsPdf } from "@/lib/export-pdf";

/**
 * Markdown / PDF export dropdown, for any generated document.
 *
 * The narrative page had this UX first, with the markdown assembly and
 * the download plumbing fused into one narrative-specific component.
 * Adding a second document type would have meant copying the whole
 * thing, so the reusable half lives here: the dropdown, the .md
 * download, the PDF delegation, and the fallback when printing can't
 * run. Callers supply finished markdown and a filename.
 *
 * PDF deliberately goes through lib/export-pdf rather than a local
 * converter, so every document in the app prints in one house style and
 * gets the full markdown pipeline — tables, lists and blockquotes
 * survive, which a hand-rolled converter tends not to manage.
 */

export interface ExportDocumentButtonProps {
  /** Finished markdown. The caller decides what belongs in the document. */
  markdown: string;
  /** Document title — used for the PDF header and the filename. */
  title: string;
  /** Fallback filename stem when the title is empty. */
  filenameFallback?: string;
  /** Tooltip on the trigger. */
  hint?: string;
  className?: string;
}

function safeFilename(title: string, fallback: string): string {
  return (
    (title || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

export default function ExportDocumentButton({
  markdown,
  title,
  filenameFallback = "document",
  hint = "Download as Markdown or PDF",
  className = "",
}: ExportDocumentButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFilename(title, filenameFallback)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    // Falls back to the markdown file rather than failing silently when
    // the print path can't run at all.
    if (!exportMarkdownAsPdf(markdown, { title })) downloadMarkdown();
  };

  if (!markdown.trim()) return null;

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
        title={hint}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Export
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={() => {
              downloadMarkdown();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <span className="text-base">📝</span>
            Download as Markdown
          </button>
          <button
            onClick={() => {
              downloadPdf();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700"
          >
            <span className="text-base">📄</span>
            Download as PDF
          </button>
          <div className="text-[10px] text-gray-400 px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
            PDF uses your browser&apos;s print dialog — pick &quot;Save as PDF&quot; as the
            destination.
          </div>
        </div>
      )}
    </div>
  );
}
