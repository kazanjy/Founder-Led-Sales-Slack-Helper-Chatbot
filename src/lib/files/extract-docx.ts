import mammoth from "mammoth";

/**
 * Shared .docx text extractor. Consumed by both the Slack file
 * ingestion pipeline (src/lib/slack/events.ts) and the web upload
 * route so the two surfaces stay in lockstep.
 *
 * Handles .docx only. Legacy .doc (application/msword) is NOT
 * supported — it's a binary format that needs native tooling
 * (antiword / catdoc) which doesn't run reliably on Vercel's
 * serverless runtime. Callers should detect .doc via isLegacyDocMime
 * and surface a "save as .docx and re-upload" message rather than
 * attempting extraction and getting a useless byte dump.
 */

// Modern Word .docx (Office Open XML).
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Legacy .doc binary format.
export const LEGACY_DOC_MIME_TYPE = "application/msword";

/** True for anything we can actually parse — .docx by MIME or extension. */
export function isDocxFile(name: string, mimetype: string | undefined | null): boolean {
  if (mimetype === DOCX_MIME_TYPE) return true;
  return typeof name === "string" && name.toLowerCase().endsWith(".docx");
}

/** True for the legacy .doc format we DON'T support. */
export function isLegacyDocMime(name: string, mimetype: string | undefined | null): boolean {
  if (mimetype === LEGACY_DOC_MIME_TYPE) return true;
  // Filename-based check as fallback — some clients omit MIME.
  const lower = typeof name === "string" ? name.toLowerCase() : "";
  return lower.endsWith(".doc") && !lower.endsWith(".docx");
}

// Cap extracted text so a huge legal contract or memoir doesn't blow
// past the model's context window (or the DB row it lands in). Well
// past a reasonable ceiling for typical sales collateral. Adjust up
// if we start seeing legitimate truncation.
const MAX_EXTRACTED_CHARS = 60_000;

export interface DocxExtractResult {
  /** Extracted text — plain text, no XML residue. Truncated to MAX_EXTRACTED_CHARS. */
  text: string;
  /** True when the raw extraction exceeded MAX_EXTRACTED_CHARS and got cut. */
  truncated: boolean;
  /** Raw char count before truncation. Handy for logs / user warnings. */
  rawCharCount: number;
  /** Warnings emitted by mammoth during parsing (unsupported styles, embedded images, etc.). */
  warnings: string[];
}

/**
 * Parse a .docx buffer to plain text. Throws on unparseable input
 * (encrypted docs, corrupted zip, non-.docx bytes). Callers should
 * try/catch and fall through to a "couldn't parse" user message.
 */
export async function extractDocxText(buffer: Buffer): Promise<DocxExtractResult> {
  const result = await mammoth.extractRawText({ buffer });
  const raw = (result.value || "").trim();
  const truncated = raw.length > MAX_EXTRACTED_CHARS;
  const text = truncated
    ? raw.substring(0, MAX_EXTRACTED_CHARS) + "\n\n… [truncated — original was " + raw.length + " chars]"
    : raw;
  return {
    text,
    truncated,
    rawCharCount: raw.length,
    warnings: (result.messages || []).map((m) => `[${m.type}] ${m.message}`),
  };
}
