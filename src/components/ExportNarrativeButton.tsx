"use client";

import { useEffect, useRef, useState } from "react";

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

// Render markdown → printable HTML and open in a new window, auto-fire
// window.print() so the user can pick "Save as PDF" in the print
// dialog. Zero dependencies and the destination is always "Save as PDF"
// by default in modern browsers. We use a minimal CSS-only renderer so
// users get heading hierarchy + paragraph spacing without us pulling
// in a heavy PDF library.
function exportAsPdf(version: NarrativeForExport, answers: AnswersByCategory | null) {
  const md = buildExportMarkdown(version, answers);
  // Tiny markdown → HTML pass: handle headings, bold, italic, code,
  // links, and paragraph breaks. Sufficient for the narrative shape
  // which doesn't use lists or tables.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = md
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("### ")) return `<h3>${escape(trimmed.slice(4))}</h3>`;
      if (trimmed.startsWith("## ")) return `<h2>${escape(trimmed.slice(3))}</h2>`;
      if (trimmed.startsWith("# ")) return `<h1>${escape(trimmed.slice(2))}</h1>`;
      // Inline formatting on a paragraph body.
      const inline = escape(trimmed)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/_([^_]+)_/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br/>");
      return `<p>${inline}</p>`;
    })
    .join("\n");

  const title = escape(version.title || "Sales Narrative");
  const doc = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #111; line-height: 1.55; max-width: 7in; margin: 0 auto; padding: 0.5in 0; font-size: 11.5pt; }
  h1 { font-size: 22pt; margin: 0 0 0.25in 0; }
  h2 { font-size: 14pt; margin: 0.35in 0 0.1in 0; border-bottom: 1px solid #ddd; padding-bottom: 4px; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 0.25in 0 0.05in 0; page-break-after: avoid; }
  p { margin: 0 0 0.12in 0; }
  strong { font-weight: 600; }
  em { font-style: italic; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 90%; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
  @media print { body { padding: 0; } }
</style>
</head><body>${html}</body></html>`;

  // window.open() returns NULL when "noopener" is in the features
  // string — by design, since noopener severs the opener reference.
  // We need the returned Window handle to write the HTML and call
  // print(), so we deliberately drop noopener/noreferrer here. The
  // destination is a same-origin about:blank we fully control, so
  // there's no XSS risk from the opener relationship.
  const w = window.open("", "_blank", "popup=1,width=900,height=1000");
  if (!w) {
    // Actual popup blocker — fall back to MD download so the user
    // still gets an artifact.
    downloadMarkdown(version, answers);
    return;
  }
  w.document.open();
  w.document.write(doc);
  w.document.close();
  // Wait a beat so fonts render before the print dialog opens.
  w.addEventListener("load", () => {
    setTimeout(() => w.print(), 200);
  });
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
