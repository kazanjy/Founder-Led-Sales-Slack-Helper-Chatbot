/**
 * Vendor registry for call recording platforms.
 *
 * Pure data module — no server-only dependencies so it can be imported
 * from both client components and server routes.
 */

export interface VendorConfig {
  id: string;
  name: string;
  urlPatterns: RegExp[];
  /** Whether we can attempt automated transcript extraction from the share link */
  extractable: boolean;
  /** Guidance shown when extraction isn't available or fails */
  manualPasteInstructions: string;
  /** CSS selector to wait for before extracting (extractable vendors only) */
  waitSelector?: string;
  /** Max ms to wait for the selector (default 15 000) */
  waitTimeout?: number;
  /** CSS selector for the transcript container */
  transcriptSelector?: string;
  /** Selectors for elements to strip before extracting text */
  cleanupSelectors?: string[];
}

export const ALL_VENDORS: VendorConfig[] = [
  // ── Extractable vendors ─────────────────────────────────────────────
  {
    id: "sybill",
    name: "Sybill",
    urlPatterns: [/app\.sybill\.ai\/conversations\/shared\/[a-f0-9-]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Sybill, open the call, click the Transcript tab, and use \"Copy Transcript\".",
    waitSelector: "[class*='transcript'], [data-testid*='transcript']",
    transcriptSelector: "[class*='transcript'], [data-testid*='transcript']",
    cleanupSelectors: ["button", "nav", "header", "[class*='toolbar']"],
  },
  {
    id: "fathom",
    name: "Fathom",
    urlPatterns: [/fathom\.video\/share\/[a-zA-Z0-9_-]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Fathom, open the shared call, click the Transcript tab, and use \"Copy All\".",
    waitSelector: "[class*='transcript'], [data-testid*='transcript']",
    transcriptSelector: "[class*='transcript'], [data-testid*='transcript']",
    cleanupSelectors: ["button", "nav", "header"],
  },
  {
    id: "fireflies",
    name: "Fireflies",
    urlPatterns: [/app\.fireflies\.ai\/view\/[a-zA-Z0-9_:-]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Fireflies, open the meeting, click Transcript, and use \"Copy Transcript\".",
    waitSelector: "[class*='transcript'], [class*='sentence']",
    transcriptSelector: "[class*='transcript'], [class*='sentence-list']",
    cleanupSelectors: ["button", "nav", "header", "[class*='sidebar']"],
  },
  {
    id: "circleback",
    name: "Circleback",
    urlPatterns: [/app\.circleback\.ai\/view\/[a-zA-Z0-9]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Circleback, open the meeting view and copy the transcript section.",
    waitSelector: "[class*='transcript'], [data-testid*='transcript']",
    transcriptSelector: "[class*='transcript'], [data-testid*='transcript']",
    cleanupSelectors: ["button", "nav", "header"],
  },
  {
    id: "otter",
    name: "Otter.ai",
    urlPatterns: [/otter\.ai\/(u|shared\/conversation)\/[a-zA-Z0-9]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Otter, open the shared note, click the transcript, and use \"Copy All\".",
    waitSelector: "[class*='transcript'], [class*='otterBody']",
    transcriptSelector: "[class*='transcript'], [class*='otterBody']",
    cleanupSelectors: ["button", "nav", "header"],
  },
  {
    id: "grain",
    name: "Grain",
    urlPatterns: [/grain\.com\/share\/[a-zA-Z0-9]+/i],
    extractable: true,
    manualPasteInstructions:
      "In Grain, open the shared recording and copy from the transcript panel.",
    waitSelector: "[class*='transcript']",
    transcriptSelector: "[class*='transcript']",
    cleanupSelectors: ["button", "nav", "header"],
  },
  {
    id: "tldv",
    name: "tl;dv",
    urlPatterns: [/tldv\.io\/app\//i],
    extractable: true,
    manualPasteInstructions:
      "In tl;dv, open the meeting, expand the transcript, and use \"Copy Transcript\".",
    waitSelector: "[class*='transcript']",
    transcriptSelector: "[class*='transcript']",
    cleanupSelectors: ["button", "nav", "header"],
  },

  // ── Non-extractable vendors ─────────────────────────────────────────
  {
    id: "granola",
    name: "Granola",
    urlPatterns: [/granola\.(ai|so)\//i],
    extractable: false,
    manualPasteInstructions:
      "Granola shared links only contain AI-generated summaries — not the full transcript. Open the call in Granola, find the full transcript, and paste it below.",
  },
  {
    id: "gong",
    name: "Gong",
    urlPatterns: [/app\.gong\.io\//i],
    extractable: false,
    manualPasteInstructions:
      "Gong requires authentication and does not support public share links. Open the call in Gong, copy the transcript, and paste it below.",
  },
  {
    id: "chorus",
    name: "Chorus",
    urlPatterns: [/chorus\.(ai|zoominfo\.com)\//i],
    extractable: false,
    manualPasteInstructions:
      "Chorus requires authentication and does not support public share links. Open the call in Chorus, copy the transcript, and paste it below.",
  },
];

/**
 * Match a URL to a known vendor. Returns null if unrecognized.
 */
export function detectVendor(url: string): VendorConfig | null {
  const trimmed = url.trim();
  for (const vendor of ALL_VENDORS) {
    for (const pattern of vendor.urlPatterns) {
      if (pattern.test(trimmed)) return vendor;
    }
  }
  return null;
}

/**
 * Quick check: does this string look like a recognized share link?
 */
export function isShareLink(text: string): boolean {
  return detectVendor(text) !== null;
}

/**
 * If the URL matches a non-extractable vendor, returns the manual paste
 * instructions. Otherwise returns null.
 */
export function getUnsupportedVendorMessage(url: string): string | null {
  const vendor = detectVendor(url);
  if (vendor && !vendor.extractable) return vendor.manualPasteInstructions;
  return null;
}
