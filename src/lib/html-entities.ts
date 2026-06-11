// Decode the most common HTML entities Google Calendar (and other
// invite sources) bake into event descriptions: &#39; → ', &amp; → &,
// &quot; → ", &lt; → <, &gt; → >, plus &nbsp;. Handles both decimal
// (&#39;) and hex (&#x27;) numeric forms. Safe to call from both
// server (Node) and client — no DOM dependency.

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  return input.replace(/&(#?)([xX]?)([a-zA-Z0-9]+);/g, (full, hash, hex, code) => {
    if (hash) {
      const n = parseInt(code, hex ? 16 : 10);
      if (Number.isFinite(n) && n > 0) {
        try { return String.fromCodePoint(n); } catch { return full; }
      }
      return full;
    }
    return NAMED[code] ?? full;
  });
}
