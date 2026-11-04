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

// Convert the small set of HTML tags Google Calendar / Mixmax / Zoom
// invite descriptions reliably contain into markdown equivalents, then
// strip any remaining tags. The result is safe to feed straight into
// ReactMarkdown — without this step the user sees literal `<br>` /
// `<a href="...">...</a>` / `<p>` text in the rendered description.
//
// Conversions:
//   <br>, <br/>, <br />               → "\n"
//   <p>...</p>                        → "\n\n...\n\n"
//   <a href="X" ...>Y</a>             → [Y](X)
//   all remaining tags                → stripped
// Then HTML entities are decoded so the final string is plain markdown.
export function htmlToMarkdown(input: string): string {
  if (!input) return input;
  let out = input;
  // <br> variants → newline
  out = out.replace(/<br\s*\/?>/gi, "\n");
  // <p> open/close → paragraph break
  out = out.replace(/<\/?p\s*>/gi, "\n\n");
  // <a href="X">Y</a> → [Y](X). Tolerates single or double quotes and
  // extra attributes (target, rel, etc.) between href and the closing
  // ">". Non-greedy on the inner text.
  out = out.replace(
    /<a\s+[^>]*href=("|')([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_full, _q, href, text) => {
      const label = text.replace(/<[^>]+>/g, "").trim() || href;
      return `[${label}](${href})`;
    }
  );
  // Strip anything else still wrapped in tag syntax.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Decode entities last so any &amp; / &#39; survives the tag-stripping
  // pass before being turned back into & / '.
  out = decodeHtmlEntities(out);
  // Collapse runs of 3+ newlines down to a clean paragraph break — the
  // <br><br> + <p></p> patterns Mixmax uses can pile up to 5 in a row.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
