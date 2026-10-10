/**
 * Per-vendor extraction strategies for both:
 *  - Browser-side scripts (Browserless headless browser)
 *  - Server-side HTML parsing (direct fetch, regex-based)
 */

import type { VendorConfig } from "./vendors";

// ══════════════════════════════════════════════════════════════════════════════
// Server-side HTML extraction (direct fetch approach)
// ══════════════════════════════════════════════════════════════════════════════

export interface HtmlExtractionConfig {
  /** Regex patterns to match the transcript container in raw HTML.
   *  Each pattern should have a capture group for the container innerHTML. */
  containerPatterns: RegExp[];
  /** Regex patterns for elements to strip from the matched container. */
  stripPatterns: RegExp[];
}

/**
 * Get the HTML extraction config for server-side parsing of a vendor's page.
 */
export function getHtmlExtractionConfig(vendor: VendorConfig): HtmlExtractionConfig {
  const custom = HTML_CONFIGS[vendor.id];
  if (custom) return custom;
  return buildDefaultHtmlConfig(vendor);
}

/**
 * Default HTML extraction config: look for common transcript container
 * patterns and strip navigation/button elements.
 */
function buildDefaultHtmlConfig(vendor: VendorConfig): HtmlExtractionConfig {
  return {
    containerPatterns: [
      // Match elements with "transcript" in a class or data-testid attribute
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script|nav)\b|$)/i,
      /<section[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
      /<div[^>]+data-testid="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script|nav)\b|$)/i,
      // Broader: any element with transcript in an attribute
      /<[a-z]+[^>]+(?:class|id|data-testid)="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/\1>/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  };
}

/** Common elements to strip from transcript HTML. */
const DEFAULT_STRIP_PATTERNS: RegExp[] = [
  /<button[\s\S]*?<\/button>/gi,
  /<nav[\s\S]*?<\/nav>/gi,
  /<header[\s\S]*?<\/header>/gi,
  /<footer[\s\S]*?<\/footer>/gi,
  /<script[\s\S]*?<\/script>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<svg[\s\S]*?<\/svg>/gi,
  /<[^>]+class="[^"]*toolbar[^"]*"[\s\S]*?<\/[^>]+>/gi,
  /<[^>]+class="[^"]*sidebar[^"]*"[\s\S]*?<\/[^>]+>/gi,
];

/**
 * Vendor-specific HTML extraction configs.
 *
 * These patterns are tuned to the known server-rendered HTML structure of each
 * vendor's public share pages. If a vendor changes their HTML, update the
 * patterns here.
 */
const HTML_CONFIGS: Record<string, HtmlExtractionConfig> = {
  sybill: {
    containerPatterns: [
      // Sybill shared conversation pages
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      /<div[^>]+data-testid="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      // Broader fallback: look for conversation/meeting content
      /<div[^>]+class="[^"]*(?:conversation|meeting|call)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: [
      ...DEFAULT_STRIP_PATTERNS,
      /<[^>]+class="[^"]*(?:action|control|menu|dropdown)[^"]*"[\s\S]*?<\/[^>]+>/gi,
    ],
  },

  fathom: {
    containerPatterns: [
      // Fathom share pages
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      /<div[^>]+data-testid="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      // Fathom may use "recording" containers
      /<div[^>]+class="[^"]*(?:recording|call-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  },

  fireflies: {
    containerPatterns: [
      // Fireflies renders transcript as individual sentence elements
      /<div[^>]+class="[^"]*(?:sentence-list|transcript-body|transcript)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      /<div[^>]+class="[^"]*(?:meeting-transcript|transcript-container)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: [
      ...DEFAULT_STRIP_PATTERNS,
      /<[^>]+class="[^"]*sidebar[^"]*"[\s\S]*?<\/[^>]+>/gi,
    ],
  },

  otter: {
    containerPatterns: [
      /<div[^>]+class="[^"]*(?:otterBody|transcript)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      /<div[^>]+class="[^"]*(?:otter-transcript|note-body)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  },

  circleback: {
    containerPatterns: [
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
      /<div[^>]+data-testid="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  },

  grain: {
    containerPatterns: [
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  },

  tldv: {
    containerPatterns: [
      /<div[^>]+class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section|footer|script)\b|$)/i,
    ],
    stripPatterns: DEFAULT_STRIP_PATTERNS,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// Browser-side extraction scripts (Browserless headless browser)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a JavaScript function body that the headless browser will execute
 * inside the share page after the waitSelector is visible.
 */
export function getExtractionScript(vendor: VendorConfig): string {
  const custom = CUSTOM_SCRIPTS[vendor.id];
  if (custom) return custom;
  return buildDefaultScript(vendor);
}

// ── Custom per-vendor scripts ────────────────────────────────────────────────

const CUSTOM_SCRIPTS: Record<string, string> = {
  fireflies: `
    // Fireflies renders sentences as individual elements
    const sentences = document.querySelectorAll("[class*='sentence']");
    if (sentences.length > 0) {
      const lines = [];
      let lastSpeaker = "";
      for (const el of sentences) {
        const speaker = el.querySelector("[class*='speaker']")?.textContent?.trim() || "";
        const text = el.querySelector("[class*='text'], [class*='content']")?.textContent?.trim()
          || el.textContent?.trim() || "";
        if (speaker && speaker !== lastSpeaker) {
          lines.push("\\n" + speaker + ":");
          lastSpeaker = speaker;
        }
        lines.push(text);
      }
      return { transcript: lines.join("\\n").trim(), title: document.title };
    }
    // Fallback to generic container
    const container = document.querySelector("[class*='transcript']");
    if (!container) throw new Error("Transcript container not found");
    return { transcript: container.textContent.trim(), title: document.title };
  `,

  sybill: `
    // Sybill typically has speaker-labeled transcript blocks
    const container = document.querySelector("[class*='transcript']")
      || document.querySelector("[data-testid*='transcript']");
    if (!container) throw new Error("Transcript container not found");

    // Strip buttons, toolbars
    for (const el of container.querySelectorAll("button, nav, [class*='toolbar']")) {
      el.remove();
    }
    return { transcript: container.textContent.trim(), title: document.title };
  `,
};

// ── Default extraction script builder ────────────────────────────────────────

function buildDefaultScript(vendor: VendorConfig): string {
  const selector = vendor.transcriptSelector || "[class*='transcript']";
  const cleanups = (vendor.cleanupSelectors || [])
    .map((s) => JSON.stringify(s))
    .join(", ");

  return `
    const container = document.querySelector(${JSON.stringify(selector)});
    if (!container) throw new Error("Transcript container not found");

    // Remove non-transcript elements
    for (const sel of [${cleanups}]) {
      for (const el of container.querySelectorAll(sel)) {
        el.remove();
      }
    }

    return { transcript: container.textContent.trim(), title: document.title };
  `;
}
