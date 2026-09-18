/**
 * Rank a workspace's channels against a deal — powers the "Suggested"
 * group at the top of the attach-channel pickers. Pure string scoring:
 * tokens from the deal's company name / deal name / domain root,
 * scored by how much of the channel name they cover (longer token
 * matches win: "adapt" → #adapt-pete-founder-led-sales).
 */

const STOP_TOKENS = new Set([
  "new", "business", "the", "and", "inc", "llc", "corp", "deal",
  "com", "www", "app", "https", "http",
]);

export function suggestChannelMatches<T extends { name: string }>(
  channels: T[],
  deal: { name?: string | null; companyName?: string | null; companyUrl?: string | null }
): T[] {
  const tokens = new Set<string>();
  const add = (s?: string | null) => {
    for (const t of (s || "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3 && !STOP_TOKENS.has(t)) tokens.add(t);
    }
  };
  add(deal.companyName);
  add(deal.name);
  add((deal.companyUrl || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0]);
  if (tokens.size === 0) return [];

  return channels
    .map((c) => {
      const n = c.name.toLowerCase();
      let score = 0;
      for (const t of tokens) if (n.includes(t)) score += t.length;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.c);
}
