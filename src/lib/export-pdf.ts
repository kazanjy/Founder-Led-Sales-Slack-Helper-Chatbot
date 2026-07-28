import { markdownToHtml } from "./clipboard";

/**
 * Export a single markdown document (one chat response, one artifact)
 * as a PDF.
 *
 * Implemented as a hidden-iframe print rather than a rasterizing
 * library (jsPDF/html2canvas): the output keeps real, selectable,
 * searchable text, proper pagination, and headings that don't split
 * across pages — and it adds zero dependencies. The browser's save
 * dialog is what actually writes the file; the document <title> below
 * becomes the suggested filename, so "Save as PDF → Desktop" lands a
 * sensibly-named file.
 */

/** Strip characters that browsers/OSes reject in filenames. */
function safeFilename(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Derive a title from the content: first markdown heading, else the
 * first sentence-ish chunk of the first non-empty line.
 */
function deriveTitle(markdown: string): string {
  const lines = markdown.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) return safeFilename(stripInlineMarkdown(heading[1]));
    // Bolded lead-in like "**What's the problem?**"
    const bold = line.match(/^\*\*(.+?)\*\*/);
    if (bold) return safeFilename(bold[1]);
    return safeFilename(stripInlineMarkdown(line).slice(0, 60));
  }
  return "Mikey response";
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[*_`#>]/g, "")
    .trim();
}

const PRINT_CSS = `
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-header {
    border-bottom: 1px solid #e5e5e5;
    padding-bottom: 10px;
    margin-bottom: 22px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 9pt;
    color: #8a8a8a;
    letter-spacing: 0.02em;
  }
  .doc-header strong { color: #6b46c1; font-weight: 600; letter-spacing: 0; }
  h1, h2, h3, h4 { color: #111; line-height: 1.25; margin: 1.4em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 19pt; margin-top: 0; }
  h2 { font-size: 15pt; }
  h3 { font-size: 12.5pt; }
  h4 { font-size: 11.5pt; }
  p { margin: 0 0 0.85em; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 0.9em; padding-left: 1.4em; }
  li { margin-bottom: 0.3em; }
  li > ul, li > ol { margin-top: 0.3em; }
  strong { color: #000; }
  blockquote {
    margin: 0 0 1em; padding: 0.2em 0 0.2em 1em;
    border-left: 3px solid #d6bcfa; color: #444; font-style: italic;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em; background: #f4f4f5; padding: 0.1em 0.35em; border-radius: 3px;
  }
  pre {
    background: #f7f7f8; padding: 0.9em; border-radius: 6px; overflow: visible;
    white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 10pt; page-break-inside: avoid; }
  th, td { border: 1px solid #ddd; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f7f5ff; font-weight: 600; }
  a { color: #6b46c1; text-decoration: none; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5em 0; }
`;

export interface ExportPdfOptions {
  /** Overrides the derived title (document title + suggested filename). */
  title?: string;
  /** Small line under the header, e.g. the conversation name. */
  subtitle?: string;
}

/**
 * Render `markdown` into a print-ready document and open the browser's
 * print/save dialog. Returns false when the environment blocks it
 * (SSR, popup/iframe restrictions) so callers can surface a toast.
 */
export function exportMarkdownAsPdf(
  markdown: string,
  options: ExportPdfOptions = {}
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const content = (markdown || "").trim();
  if (!content) return false;

  try {
    const title = safeFilename(options.title || deriveTitle(content)) || "Mikey response";
    const dateLabel = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const bodyHtml = markdownToHtml(content);

    const iframe = document.createElement("iframe");
    // Off-screen rather than display:none — some browsers won't paint
    // (and therefore won't print) a fully hidden frame.
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return false;
    }

    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8" />` +
        // The <title> is what print-to-PDF suggests as the filename.
        `<title>${escapeHtml(title)}</title>` +
        `<style>${PRINT_CSS}</style></head><body>` +
        `<div class="doc-header"><strong>Mikey</strong><span>${escapeHtml(
          options.subtitle ? `${options.subtitle} · ${dateLabel}` : dateLabel
        )}</span></div>` +
        bodyHtml +
        `</body></html>`
    );
    doc.close();

    let printed = false;
    const finish = () => {
      if (printed) return; // onload and the safety net can both fire
      printed = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("[export-pdf] print failed:", err);
      }
      // Leave the frame up long enough for the dialog to take over the
      // document, then clean up. Removing immediately cancels printing
      // in Safari.
      window.setTimeout(() => iframe.remove(), 60_000);
    };

    // Wait for images/fonts in the frame before printing.
    if (iframe.contentWindow?.document.readyState === "complete") {
      window.setTimeout(finish, 60);
    } else {
      iframe.onload = () => window.setTimeout(finish, 60);
      // Safety net if onload never fires.
      window.setTimeout(finish, 800);
    }
    return true;
  } catch (err) {
    console.error("[export-pdf] failed:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
