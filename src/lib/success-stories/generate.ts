import { randomUUID } from "crypto";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext } from "@/lib/seller-context";

/**
 * Quotes & Success Stories (success-stories-plan.md).
 *
 * Layer 1: extractProofPoints — one pass over all call sources +
 * seller narrative → structured, verbatim-quoted, narrative-aligned
 * proof points (the durable layer). Re-extraction carries forward
 * prior include/exclude decisions.
 *
 * Layer 2/3: generateSuccessAsset — project the INCLUDED proof points
 * into a (medium × format) asset. Six mediums (attributed + blind
 * variants of testimonial / success story / case study); Phase 1
 * ships the "web" format.
 */

export interface SourceCall {
  id: string;
  title: string;
  date: string | null; // YYYY-MM-DD
  origin: "paste" | "recorder" | "deal";
  content: string;
}

export interface ProofPoint {
  id: string;
  claim: string;
  quote: string;
  speaker: string | null;
  role: string | null;
  date: string | null;
  metric: string | null;
  narrativePillar: string | null;
  arc: "single" | "before_after" | "progression";
  themeMatch: boolean;
  included: boolean;
}

export const SUCCESS_MEDIUMS: Array<{
  key: string;
  label: string;
  blind: boolean;
  instructions: string;
}> = [
  {
    key: "testimonial",
    label: "Customer testimonial",
    blind: false,
    instructions:
      "An attributed testimonial quote block: 2-5 sentences in the customer's FIRST-PERSON voice, lightly polished from their verbatim quotes (fix disfluencies, never invent claims), followed by an attribution line — Name, Role, Company. Lead with the strongest metric. If multiple distinct proof themes exist, produce 2-3 separate testimonial blocks.",
  },
  {
    key: "blind_testimonial",
    label: "Blind testimonial",
    blind: true,
    instructions:
      "An anonymized third-person-attributed testimonial: the quote itself stays first-person, but the attribution is a credible descriptor instead of a name ('VP of Finance, Series B fintech'). 2-5 sentences per block; 2-3 blocks if themes are distinct. Lead with metrics.",
  },
  {
    key: "success_story",
    label: "Success story",
    blind: false,
    instructions:
      "A named success story, 2-4 tight paragraphs: the situation they were in, what changed with the product, and the proof (metrics + a short embedded quote). Multi-call sources: tell the before → after arc with the timeframe. Single-call sources: frame the current state of success. End on the strongest number.",
  },
  {
    key: "blind_success_story",
    label: "Blind success story",
    blind: true,
    instructions:
      "Same shape as the success story — 2-4 paragraphs, arc-aware, quote embedded — but anonymized: industry + stage + team-shape descriptors replace the customer identity ('a Series B fintech's 40-person collections team'), and quotes attribute as 'their VP of Finance told us…'.",
  },
  {
    key: "case_study",
    label: "Case study",
    blind: false,
    instructions:
      "The long form, with section headers: Situation (who they are, the problem, what it cost them) → Why they chose us → Implementation (how rollout actually went) → Results over time (the arc, metric by metric, with dates where known) → Where they're going. Embed 2-4 verbatim quotes. 500-900 words.",
  },
  {
    key: "blind_case_study",
    label: "Blind case study",
    blind: true,
    instructions:
      "The case-study long form under full anonymization. Keep situation details (industry, scale, tooling, team shape) specific enough to be CREDIBLE without letting them triangulate the customer's identity — when a detail is uniquely identifying (a famous product, an unusual niche), generalize it one notch. All metrics stay. Quotes attribute by role descriptor only. 500-900 words.",
  },
];

export const SUCCESS_FORMATS: Array<{ key: string; label: string; instructions: string }> = [
  {
    key: "web",
    label: "Web / blog text",
    instructions:
      "Clean markdown for a website or blog: a compelling headline, subheads where the medium calls for sections, short paragraphs, quotes as blockquotes. No hashtags, no emoji.",
  },
];

const BLIND_CONTRACT = `ANONYMIZATION CONTRACT (applies because this is a BLIND medium):
- Strip customer names, company name, product names of theirs, city/geography specifics, and any uniquely identifying detail.
- Replace identity with credible descriptors: industry + stage + team shape ("a Series B fintech", "their 12-person CS team").
- ALWAYS keep the metrics and numbers — anonymized proof without numbers is noise.
- Never fabricate descriptors; derive them from the evidence.`;

const EXTRACTION_PROMPT = `You are extracting CUSTOMER PROOF POINTS from call transcripts/notes — evidence that the founder's product delivered real results for this customer. The founder is the SELLER; the customer voices in the calls are the proof.

Return ONLY a JSON object:
{
  "proofPoints": [
    {
      "claim": "<one-sentence human-readable proof statement, specific and metric-forward>",
      "quote": "<short VERBATIM quote from the evidence that supports it (max ~300 chars)>",
      "speaker": "<who said it, or null>",
      "role": "<their role/title if known, or null>",
      "date": "YYYY-MM-DD" | null,
      "metric": "<the number(s), as 'before → after' when the calls show change over time, or null>",
      "narrativePillar": "<which claim of the founder's sales narrative this proves, in a few words, or null>",
      "arc": "single" | "before_after" | "progression",
      "themeMatch": true | false
    }
  ]
}

Rules:
- QUOTES ARE MANDATORY and verbatim. No quote, no proof point.
- Only CUSTOMER-VOICED proof counts — the founder praising their own product is not evidence.
- Prefer quantified proof; qualitative proof ("the team actually likes using it") is valid when vivid.
- MULTI-CALL sources: hunt for change over time — the same metric or pain discussed across calls becomes ONE proof point with arc "before_after"/"progression" and a before → after metric. Don't emit the before and after as separate points.
- narrativePillar: match each point to the founder's sales narrative (provided) — proof that ladders to the narrative is what makes these usable downstream. null when it genuinely proves nothing the narrative claims.
- themeMatch: true when the point hits the user's THEME FOCUS (provided; may be empty).
- Dedupe aggressively; cap at 12 points, strongest first. An empty array is a valid answer.`;

function normQuote(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
}

export async function extractProofPoints(
  userId: string,
  collectionId: string
): Promise<{ proofPoints: ProofPoint[] } | null> {
  const collection = await prisma.successStoryCollection.findFirst({
    where: { id: collectionId, userId },
  });
  if (!collection) return null;
  const sources = (collection.sources as unknown as SourceCall[]) || [];
  if (sources.length === 0 || !sources.some((s) => s.content?.trim())) {
    return { proofPoints: [] };
  }

  const seller = await loadSellerContext(userId);
  // House rule: no arbitrary clamps — full transcripts in, newest
  // last so the model reads chronologically. 600K global budget.
  let evidence = "";
  for (const s of [...sources].sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
    const block = `### Call: ${s.title}${s.date ? ` (${s.date})` : ""}\n${s.content.trim()}\n\n`;
    if (evidence.length + block.length > 600_000) break;
    evidence += block;
  }

  const payload = {
    customerName: collection.customerName || "(unknown — infer from the calls)",
    themeFocus: collection.themeFocus?.trim() || "(none — generic extraction)",
    foundersSalesNarrative: seller.narrative?.substring(0, 10_000) || "(none authored)",
    foundersValueProp: seller.valueProp100w?.substring(0, 1500) || "(none)",
    callEvidence: evidence,
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: { proofPoints?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Proof point extraction returned unparseable JSON");
  }

  const prior = (collection.proofPoints as unknown as ProofPoint[] | null) || [];
  const priorByQuote = new Map(prior.map((p) => [normQuote(p.quote), p]));

  const proofPoints: ProofPoint[] = [];
  for (const raw of (parsed.proofPoints || []).slice(0, 12)) {
    const claim = typeof raw.claim === "string" ? raw.claim.trim() : "";
    const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
    if (!claim || !quote) continue;
    // Carry forward the founder's include/exclude decision when the
    // same quote resurfaces on re-extraction.
    const carried = priorByQuote.get(normQuote(quote));
    proofPoints.push({
      id: carried?.id || randomUUID(),
      claim,
      quote: quote.slice(0, 400),
      speaker: typeof raw.speaker === "string" && raw.speaker ? raw.speaker : null,
      role: typeof raw.role === "string" && raw.role ? raw.role : null,
      date: typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null,
      metric: typeof raw.metric === "string" && raw.metric ? raw.metric : null,
      narrativePillar:
        typeof raw.narrativePillar === "string" && raw.narrativePillar ? raw.narrativePillar : null,
      arc:
        raw.arc === "before_after" || raw.arc === "progression"
          ? raw.arc
          : "single",
      themeMatch: raw.themeMatch === true,
      included: carried ? carried.included : true,
    });
  }

  await prisma.successStoryCollection.update({
    where: { id: collectionId },
    data: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proofPoints: proofPoints as any,
      proofPointsAt: new Date(),
    },
  });
  return { proofPoints };
}

const GENERATION_PROMPT = `You are writing a customer-proof marketing asset for a founder-led sales company, from EXTRACTED PROOF POINTS (each with a verbatim customer quote). Write in the founder's voice and vocabulary (their sales narrative is provided) — confident, specific, zero marketing fluff.

Hard rules:
- Use ONLY the provided proof points — never invent claims, quotes, numbers, or details.
- Quotes may be lightly polished (disfluencies removed) but never changed in meaning; a quote's metric must appear exactly as extracted.
- Lead with the strongest, most quantified proof.
- Respect the arc: before → after proof points tell a change-over-time story; frame timeframes honestly.
- Return ONLY the asset text (markdown), no preamble, no commentary.`;

export async function generateSuccessAsset(
  userId: string,
  collectionId: string,
  mediumKey: string,
  formatKey: string
): Promise<{ assetId: string; content: string } | null> {
  const medium = SUCCESS_MEDIUMS.find((m) => m.key === mediumKey);
  const format = SUCCESS_FORMATS.find((f) => f.key === formatKey);
  if (!medium || !format) throw new Error("Unknown medium or format");

  const collection = await prisma.successStoryCollection.findFirst({
    where: { id: collectionId, userId },
  });
  if (!collection) return null;
  const allPoints = (collection.proofPoints as unknown as ProofPoint[] | null) || [];
  const points = allPoints.filter((p) => p.included !== false);
  if (points.length === 0) throw new Error("No included proof points — run extraction first");

  const seller = await loadSellerContext(userId);
  const sections = [
    GENERATION_PROMPT,
    `## Medium: ${medium.label}\n${medium.instructions}`,
    medium.blind ? BLIND_CONTRACT : "",
    `## Format: ${format.label}\n${format.instructions}`,
    `## Customer\n${collection.customerName || "(infer from proof points)"}${collection.themeFocus?.trim() ? `\n\nTheme focus the founder cares about: ${collection.themeFocus.trim()}` : ""}`,
    `## Founder's Sales Narrative (voice + claims to ladder to)\n${seller.narrative?.substring(0, 10_000) || "(none)"}\n\n### Value prop (100w)\n${seller.valueProp100w?.substring(0, 1500) || "(none)"}`,
    `## Proof Points\n${JSON.stringify(points, null, 2)}`,
  ].filter(Boolean);

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    max_completion_tokens: 6000,
    messages: [{ role: "user", content: sections.join("\n\n---\n\n") }],
  });
  const content = completion.choices[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("Asset generation came back empty");

  const asset = await prisma.successAsset.create({
    data: {
      collectionId,
      medium: mediumKey,
      format: formatKey,
      content,
    },
  });
  return { assetId: asset.id, content };
}
