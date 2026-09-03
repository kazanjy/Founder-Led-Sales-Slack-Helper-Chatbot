/**
 * Markdown builders for the Playbook artifacts.
 *
 * Every Playbook page can export, but they do not share a content
 * shape: the checklists are plain markdown strings, while the ICP,
 * Discovery Questions and Sales Motion are structured JSON that the
 * page renders into headings and lists. A generic exporter would either
 * dump JSON or flatten the structure, so each artifact gets a builder
 * that mirrors what its page actually shows on screen.
 *
 * Assembly (title, dateline, Q&A) still comes from lib/export-markdown,
 * so every exported file in Mikey shares one house format.
 */

import { buildExportMarkdown, type ExportAnswersByCategory } from "./export-markdown";

// ── Ideal Customer Profile ────────────────────────────────────────

export interface IcpExportContent {
  sections?: Array<{ name: string; description?: string; items?: string[] }>;
  searchCriteria?: Array<{
    name: string;
    filters?: Array<{ facet: string; values?: string[]; notes?: string }>;
    booleanSearch?: string;
    tips?: string[];
  }>;
}

export function buildIcpMarkdown(
  title: string,
  content: IcpExportContent | null,
  dateLabel?: string | null,
  answersByCategory?: ExportAnswersByCategory | null
): string {
  const lines: string[] = [];

  for (const s of content?.sections || []) {
    lines.push(`### ${s.name}`, "");
    if (s.description?.trim()) lines.push(s.description.trim(), "");
    for (const item of s.items || []) lines.push(`- ${item}`);
    if ((s.items || []).length) lines.push("");
  }

  // The search-criteria tab is the operationally useful half — it is
  // what someone pastes into Apollo or LinkedIn — so it exports too
  // rather than being dropped as "just filters".
  const criteria: string[] = [];
  for (const p of content?.searchCriteria || []) {
    criteria.push(`### ${p.name}`, "");
    for (const f of p.filters || []) {
      const values = (f.values || []).join(", ");
      criteria.push(`- **${f.facet}:** ${values}${f.notes ? ` — _${f.notes}_` : ""}`);
    }
    if ((p.filters || []).length) criteria.push("");
    if (p.booleanSearch?.trim()) {
      criteria.push("**Boolean search**", "", "```", p.booleanSearch.trim(), "```", "");
    }
    for (const t of p.tips || []) criteria.push(`- ${t}`);
    if ((p.tips || []).length) criteria.push("");
  }

  return buildExportMarkdown({
    title,
    dateLabel,
    sections: [
      { heading: "Profile", body: lines.join("\n") },
      { heading: "Search Criteria", body: criteria.join("\n") },
    ],
    answersByCategory,
  });
}

// ── Discovery Questions ───────────────────────────────────────────

export interface DiscoveryExportContent {
  categories?: Array<{
    name: string;
    description?: string;
    questions?: Array<{ primary: string; followUps?: string[] }>;
  }>;
}

export function buildDiscoveryQuestionsMarkdown(
  title: string,
  content: DiscoveryExportContent | null,
  dateLabel?: string | null,
  answersByCategory?: ExportAnswersByCategory | null
): string {
  const lines: string[] = [];
  for (const c of content?.categories || []) {
    lines.push(`### ${c.name}`, "");
    if (c.description?.trim()) lines.push(`_${c.description.trim()}_`, "");
    for (const q of c.questions || []) {
      lines.push(`**${q.primary}**`, "");
      // Follow-ups are the part a rep actually needs in the room, so
      // they stay attached to their primary rather than being collapsed.
      for (const f of q.followUps || []) lines.push(`- ${f}`);
      if ((q.followUps || []).length) lines.push("");
    }
  }
  return buildExportMarkdown({
    title,
    dateLabel,
    sections: [{ body: lines.join("\n") }],
    answersByCategory,
  });
}

// ── Sales Motion ──────────────────────────────────────────────────

export interface SalesMotionExportCollection {
  title?: string;
  salesMotionSynthesis?: string;
  scripts?: Array<{ callType: string; title: string; content: string }>;
  deals?: Array<{
    name: string;
    calls?: Array<{ name: string; callType: string; summary: string }>;
  }>;
}

export function buildSalesMotionMarkdown(
  title: string,
  collection: SalesMotionExportCollection | null,
  dateLabel?: string | null
): string {
  const scripts: string[] = [];
  for (const s of collection?.scripts || []) {
    scripts.push(`### ${s.title}`, "");
    if (s.callType) scripts.push(`_${s.callType}_`, "");
    if (s.content?.trim()) scripts.push(s.content.trim(), "");
  }

  // The deal/call evidence the synthesis was drawn from. Included so a
  // reader can check the conclusions against what was actually on the
  // calls, rather than taking the synthesis on faith.
  const evidence: string[] = [];
  for (const d of collection?.deals || []) {
    evidence.push(`### ${d.name}`, "");
    for (const c of d.calls || []) {
      evidence.push(`**${c.name}**${c.callType ? ` — ${c.callType}` : ""}`, "");
      if (c.summary?.trim()) evidence.push(c.summary.trim(), "");
    }
  }

  return buildExportMarkdown({
    title,
    dateLabel,
    sections: [
      { heading: "Sales Motion", body: collection?.salesMotionSynthesis },
      { heading: "Call Playbooks", body: scripts.join("\n") },
      { heading: "Source Calls", body: evidence.join("\n") },
    ],
  });
}

// ── Sales Asset Library ───────────────────────────────────────────

export interface AssetExportRow {
  name: string;
  description?: string | null;
  category: string;
  currentUrl?: string | null;
  currentLabel?: string | null;
}

export function buildAssetLibraryMarkdown(
  title: string,
  assets: AssetExportRow[],
  dateLabel?: string | null
): string {
  // Grouped by category, in first-seen order, so the export reads the
  // way the page does rather than in database order.
  const byCategory = new Map<string, AssetExportRow[]>();
  for (const a of assets) {
    const list = byCategory.get(a.category) || [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  const lines: string[] = [];
  for (const [category, rows] of byCategory) {
    lines.push(`### ${category}`, "");
    for (const a of rows) {
      const link = a.currentUrl
        ? `[${a.currentLabel?.trim() || "Open"}](${a.currentUrl})`
        : "_No link yet_";
      lines.push(`- **${a.name}** — ${link}`);
      if (a.description?.trim()) lines.push(`  - ${a.description.trim()}`);
    }
    lines.push("");
  }

  return buildExportMarkdown({
    title,
    dateLabel,
    sections: [{ body: lines.join("\n") }],
  });
}

// ── Plain-markdown artifacts ──────────────────────────────────────

/**
 * For artifacts whose content is already one markdown string — the
 * First Call Checklist and the Pre-Call Checklist.
 */
export function buildPlainMarkdown(
  title: string,
  content: string | null | undefined,
  dateLabel?: string | null,
  answersByCategory?: ExportAnswersByCategory | null
): string {
  return buildExportMarkdown({
    title,
    dateLabel,
    sections: [{ body: content }],
    answersByCategory,
  });
}
