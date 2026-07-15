import { prisma } from "@/lib/db";

/**
 * Paste-time duplicate detection for deal evidence (autopilot plan
 * Part 3 — proof capture). Before a pasted/dropped email-slack-
 * imessage capture lands on the timeline, check whether the deal
 * already carries the same correspondence and discard with a NAMED
 * match instead of silently double-logging.
 *
 * Deterministic (no LLM): word-shingle CONTAINMENT — the overlap
 * divided by the SMALLER shingle set — so a screenshot of one email
 * still matches an entry holding the whole thread. OCR noise and
 * cropped margins survive a 0.6 bar comfortably; genuinely new
 * replies in an existing thread don't reach it.
 */

const SHINGLE_SIZE = 5;
const CONTAINMENT_THRESHOLD = 0.6;
// Don't dupe-judge tiny fragments — too little signal.
const MIN_TOKENS = 30;
// Compare against this many recent correspondence-ish entries.
const CANDIDATE_LIMIT = 60;
const CLAMP_CHARS = 20_000;

const DUPE_CHECKED_TYPES = [
  "email",
  "slack_message",
  "sms_message",
  "linkedin",
  "screenshot",
  "note",
  "evidence",
  "call_summary",
  "call_transcript",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i++) {
    out.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return out;
}

function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const s of small) if (large.has(s)) hit++;
  return hit / small.size;
}

export interface DuplicateMatch {
  entryId: string;
  title: string | null;
  entryDate: Date;
  type: string;
  score: number;
}

/** Should this entry type / content combination be dupe-checked at all? */
export function isDupeCheckable(type: string, content: string): boolean {
  if (!DUPE_CHECKED_TYPES.includes(type)) return false;
  return tokenize(content.substring(0, CLAMP_CHARS)).length >= MIN_TOKENS;
}

/**
 * Find the best duplicate among the deal's recent entries, or null.
 */
export async function findDuplicateEntry(
  dealId: string,
  content: string
): Promise<DuplicateMatch | null> {
  const tokens = tokenize(content.substring(0, CLAMP_CHARS));
  if (tokens.length < MIN_TOKENS) return null;
  const incoming = shingles(tokens);

  const candidates = await prisma.dealTimelineEntry.findMany({
    where: { dealId, type: { in: DUPE_CHECKED_TYPES } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: CANDIDATE_LIMIT,
    select: { id: true, title: true, entryDate: true, type: true, content: true },
  });

  let best: DuplicateMatch | null = null;
  for (const c of candidates) {
    const score = containment(
      incoming,
      shingles(tokenize(c.content.substring(0, CLAMP_CHARS)))
    );
    if (score >= CONTAINMENT_THRESHOLD && (!best || score > best.score)) {
      best = { entryId: c.id, title: c.title, entryDate: c.entryDate, type: c.type, score };
    }
  }
  return best;
}
