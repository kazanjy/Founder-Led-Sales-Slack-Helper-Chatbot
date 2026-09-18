/**
 * Assemble a generated artifact into an export-ready markdown document.
 *
 * Every generated artifact in Mikey has the same export shape: a title,
 * a dateline, the body, and optionally the questionnaire answers it was
 * generated from. Sharing the assembly keeps exported files consistent
 * across artifacts and means a fix to the Q&A rendering lands
 * everywhere rather than in whichever page was edited last.
 */

export interface ExportAnswer {
  globalOrder: number;
  question: string;
  answer: string | null;
}

export type ExportAnswersByCategory = Record<string, ExportAnswer[]>;

export interface BuildExportMarkdownOptions {
  title: string;
  /** Ordered body sections. Empty bodies are skipped, not left as gaps. */
  sections: Array<{ heading?: string; body?: string | null }>;
  /** Rendered under a "Q&A" heading when present. */
  answersByCategory?: ExportAnswersByCategory | null;
  /** Shown as an italic dateline under the title. */
  dateLabel?: string | null;
  datePrefix?: string;
}

export function buildExportMarkdown({
  title,
  sections,
  answersByCategory,
  dateLabel,
  datePrefix = "Last updated",
}: BuildExportMarkdownOptions): string {
  const lines: string[] = [`# ${title.trim()}`];

  if (dateLabel) {
    const d = new Date(dateLabel);
    if (!Number.isNaN(d.getTime())) {
      lines.push(
        `*${datePrefix} ${d.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}*`
      );
    }
  }
  lines.push("");

  for (const section of sections) {
    const body = section.body?.trim();
    if (!body) continue;
    if (section.heading) {
      lines.push(`## ${section.heading}`);
      lines.push("");
    }
    lines.push(body);
    lines.push("");
  }

  if (answersByCategory && Object.keys(answersByCategory).length > 0) {
    lines.push("## Q&A");
    lines.push("");
    for (const [category, list] of Object.entries(answersByCategory)) {
      lines.push(`### ${category}`);
      lines.push("");
      for (const qa of list) {
        lines.push(`**Q${qa.globalOrder}: ${qa.question}**`);
        lines.push("");
        // An unanswered question is preserved rather than dropped — the
        // gaps are part of what the reader needs to see.
        lines.push(qa.answer?.trim() || "_(Not answered)_");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
