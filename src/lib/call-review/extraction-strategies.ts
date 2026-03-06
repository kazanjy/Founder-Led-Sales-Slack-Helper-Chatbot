/**
 * Per-vendor browser-side extraction scripts.
 *
 * Each function returns a JavaScript string that runs in the headless browser
 * page context. The script must return { transcript: string, title?: string }
 * or throw on failure.
 */

import type { VendorConfig } from "./vendors";

/**
 * Build a JavaScript function body that the headless browser will execute
 * inside the share page after the waitSelector is visible.
 */
export function getExtractionScript(vendor: VendorConfig): string {
  // Vendors with highly unique DOM structures can get custom overrides here.
  const custom = CUSTOM_SCRIPTS[vendor.id];
  if (custom) return custom;

  // Default strategy: remove cleanup elements, then grab textContent from
  // the transcriptSelector container.
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
