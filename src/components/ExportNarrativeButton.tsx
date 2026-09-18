"use client";

import ExportDocumentButton from "@/components/ExportDocumentButton";
import { buildExportMarkdown, type ExportAnswersByCategory } from "@/lib/export-markdown";

/**
 * Sales-narrative export.
 *
 * This used to carry the dropdown, the .md download and the PDF
 * plumbing inline. All of that moved to ExportDocumentButton and
 * lib/export-markdown when the hiring profile needed the same export,
 * so what's left here is the only genuinely narrative-specific part:
 * which fields make up the document and in what order. The props and
 * behaviour are unchanged.
 */

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
  answersByCategory: ExportAnswersByCategory | null;
}

export default function ExportNarrativeButton({ version, answersByCategory }: Props) {
  const hasContent = !!(version.narrative || version.description100w || answersByCategory);
  if (!hasContent) return null;

  const title = (version.title || "Sales Narrative").trim();
  const markdown = buildExportMarkdown({
    title,
    dateLabel: version.updatedAt,
    sections: [
      { heading: "Full Narrative", body: version.narrative },
      { heading: "1000-Word Description", body: version.description1000w },
      { heading: "100-Word Description", body: version.description100w },
      { heading: "50-Word Description", body: version.description50w },
      { heading: "25-Word Description", body: version.description25w },
    ],
    answersByCategory,
  });

  return (
    <ExportDocumentButton
      markdown={markdown}
      title={title}
      filenameFallback="sales-narrative"
      hint="Download the narrative as Markdown or PDF"
    />
  );
}
