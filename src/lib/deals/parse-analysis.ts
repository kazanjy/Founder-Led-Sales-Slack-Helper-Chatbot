/**
 * Parser for the markdown blobs that `runDealAnalysis` writes into
 * `Deal.lastAnalysis`. The deals list page uses this to surface the
 * Current State / Last Meaningful Interaction / Next Best Action
 * widgets in the right rail of each card without re-running anything.
 *
 * Each widget gets a `headline` (single line / first bullet for the
 * clipped 2-line preview) plus `full` (the raw section markdown for
 * the hover popover).
 *
 * The analyzer's section headers are a stable contract (see
 * sectionRequirements in src/lib/deals/analyze.ts) so we just match by
 * the literal heading. Re-analyses use "What's Next" in place of
 * "Recommended Next Steps"; we accept either.
 *
 * Backwards compatibility note: analyses produced before the
 * "Last Meaningful Interaction" section was added simply return null
 * for that widget — the list page renders a "Re-analyze to populate"
 * hint in that slot.
 */

export interface AnalysisSection {
  headline: string;
  full: string;
}

export interface ParsedDealAnalysis {
  currentState: AnalysisSection | null;
  lastInteraction: AnalysisSection | null;
  nextBestAction: AnalysisSection | null;
}

const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/;

function splitSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = markdown.split(/\r?\n/);
  let currentHeader: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (currentHeader !== null) {
      out[currentHeader.toLowerCase()] = buf.join("\n").trim();
    }
  };
  for (const line of lines) {
    const match = line.match(SECTION_HEADER_RE);
    if (match) {
      flush();
      currentHeader = match[1].trim();
      buf = [];
    } else if (currentHeader !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

// Pull the first substantive sentence out of a paragraph blob. Used
// for Current State / Last Interaction where the analyzer writes a
// short paragraph but the widget can only show ~2 lines worth.
function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/)[0]?.trim() || "";
}

// Pull the first bullet out of a markdown list. Strips the leading
// "- " / "* " / "1. " markers and any bold markdown on the label so
// the widget gets clean prose.
function firstBullet(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (m) {
      return m[1]
        .replace(/^\*\*([^*]+)\*\*:\s*/, "$1: ")
        .replace(/^\*\*([^*]+)\*\*\s*$/, "$1")
        .trim();
    }
  }
  // No bullet found — fall back to first non-empty line (the analyzer
  // sometimes writes a paragraph instead of a list for short sections).
  for (const raw of lines) {
    const line = raw.trim();
    if (line) return line;
  }
  return "";
}

export function parseDealAnalysis(markdown: string | null | undefined): ParsedDealAnalysis {
  if (!markdown || !markdown.trim()) {
    return { currentState: null, lastInteraction: null, nextBestAction: null };
  }
  const sections = splitSections(markdown);

  const dealSummary = sections["deal summary"] || "";
  const lastInteractionFull = sections["last meaningful interaction"] || "";
  // Re-analysis prompt writes "What's Next" instead of "Recommended
  // Next Steps" — accept either.
  const nextStepsFull = sections["what's next"] || sections["recommended next steps"] || "";

  return {
    currentState: dealSummary
      ? { headline: firstParagraph(dealSummary), full: dealSummary }
      : null,
    lastInteraction: lastInteractionFull
      ? { headline: firstParagraph(lastInteractionFull), full: lastInteractionFull }
      : null,
    nextBestAction: nextStepsFull
      ? { headline: firstBullet(nextStepsFull), full: nextStepsFull }
      : null,
  };
}
