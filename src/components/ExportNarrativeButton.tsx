"use client";

import { useEffect, useRef, useState } from "react";
import { exportMarkdownAsPdf } from "@/lib/export-pdf";

interface AnswerEntry {
  globalOrder: number;
  question: string;
  answer: string | null;
}

interface AnswersByCategory {
  [category: string]: AnswerEntry[];
}

interface NarrativeForExport {
  title?: string | null;
  narrative?: string | null;
  description1000w?: string | null;
  description100w?: string | null;
  description50w?: string | null;
  description25w?: string | null;
  updatedAt?: string | null;
}

interface Props {
  version: NarrativeForExport;
  answersByCategory: AnswersByCategory | null;
}

// Build the full export markdown — same shape as the Chat About Sales
// Narrative context plus a leading H1 + last-updated timestamp, so the
// downloaded file is a complete, dated document the user can hand off.
function buildExportMarkdown(version: NarrativeForExport, answers: AnswersByCategory | null): string {
  const lines: string[] = [];
  const title = (version.title || "Sales Narrative").trim();
  lines.push(`# ${title}`);
  if (version.updatedAt) {
    const d = new Date(version.updatedAt);
    if (!Number.isNaN(d.getTime())) {
      lines.push(`*Last updated ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}*`);
    }
  }
  lines.push("");
  if (version.narrative) {
    lines.push("## Full Narrative");
    lines.push("");
    lines.push(version.narrative.trim());
    lines.push("");
  }
  if (version.description1000w) {
    lines.push("## 1000-Word Description");
    lines.push("");
    lines.push(version.description1000w.trim());
    lines.push("");
  }
  if (version.description100w) {
    lines.push("## 100-Word Description");
    lines.push("");
    lines.push(version.description100w.trim());
    lines.push("");
  }
  if (version.description50w) {
    lines.push("## 50-Word Description");
    lines.push("");
    lines.push(version.description50w.trim());
    lines.push("");
  }
  if (version.description25w) {
    lines.push("## 25-Word Description");
    lines.push("");
    lines.push(version.description25w.trim());
    lines.push("");
  }
  if (answers) {
    lines.push("## Q&A");
    lines.push("");
    for (const [category, list] of Object.entries(answers)) {
      lines.push(`### ${category}`);
      lines.push("");
      for (const qa of list) {
        lines.push(`**Q${qa.globalOrder}: ${qa.question}**`);
        lines.push("");
        lines.push(qa.answer?.trim() || "_(Not answered)_");
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

function safeFilename(title: string): string {
  return (title || "sales-narrative")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sales-narrative";
}

function downloadMarkdown(version: NarrativeForExport, answers: AnswersByCategory | null) {
  const md = buildExportMarkdown(version, answers);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(version.title || "sales-narrative")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// PDF export delegates to the shared lib/export-pdf utility so the
// whole app produces one house style. That also upgrades this export:
// the bespoke converter that used to live here only handled headings,
// bold, italic and code ("sufficient for the narrative shape"), while
// the shared path runs the full `marked` pipeline — so Q&A lists,
// tables and blockquotes now survive into the PDF. Popup blockers
// aren't a factor either (it prints from an off-screen iframe), but we
// keep the markdown download as a fallback if it can't run at all.
function exportAsPdf(version: NarrativeForExport, answers: AnswersByCategory | null) {
  const md = buildExportMarkdown(version, answers);
  const ok = exportMarkdownAsPdf(md, { title: version.title || "Sales Narrative" });
  if (!ok) downloadMarkdown(version, answers);
}

export default function ExportNarrativeButton({ version, answersByCategory }: Props) {
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

  const hasContent = !!(version.narrative || version.description100w || answersByCategory);
  if (!hasContent) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
        title="Download the narrative as Markdown or PDF"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={() => { downloadMarkdown(version, answersByCategory); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <span className="text-base">📝</span>
            Download as Markdown
          </button>
          <button
            onClick={() => { exportAsPdf(version, answersByCategory); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700"
          >
            <span className="text-base">📄</span>
            Download as PDF
          </button>
          <div className="text-[10px] text-gray-400 px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
            PDF uses your browser&apos;s print dialog — pick &quot;Save as PDF&quot; as the destination.
          </div>
        </div>
      )}
    </div>
  );
}
