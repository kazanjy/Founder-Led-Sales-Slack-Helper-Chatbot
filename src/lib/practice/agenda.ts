import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";
import type { PracticePersonaPublic } from "./persona";

/**
 * Agenda-setting drill: script sourcing.
 *
 * The script the founder practices against comes from, in priority
 * order:
 *  1. Their saved default (GtmVariable AGENDA_SCRIPT — written by the
 *     drill's "Save as my default" affordance, and readable by every
 *     agent surface like any other merge field).
 *  2. Generated fresh from their first-call checklist + value prop.
 *  3. A generic Founding-Sales-style skeleton when neither exists.
 *
 * Session-local edits in the drill never touch the default unless the
 * founder explicitly saves back.
 */

const FALLBACK_SCRIPT = `Thanks for making the time today. I want to be respectful of the half hour, so here's what I was thinking. First, I'd love to learn a bit about how you're handling this today and what's working or not. And just to provide some context, {{SOLUTION NAME}} helps {{WHO}} {{CORE OUTCOME}} without {{THE PAINFUL PART}} — teams typically see {{HEADLINE RESULT}}. So after we've talked through your world, I'll show you how that might map to what you're doing — and if it feels relevant, we can figure out next steps together; if it doesn't, that's genuinely useful to know too. Does that work for you? Anything else you want to make sure we cover before we dive in?`;

export async function getAgendaScript(
  userId: string,
  personaPublic: PracticePersonaPublic
): Promise<{ script: string; source: "saved_default" | "generated" | "fallback" }> {
  // 1. Saved default.
  const saved = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "AGENDA_SCRIPT" },
    select: { value: true },
  });
  if (saved?.value?.trim()) {
    return { script: saved.value.trim(), source: "saved_default" };
  }

  // 2. Generate from the first-call checklist + positioning.
  const [checklist, seller] = await Promise.all([
    prisma.firstCallChecklistVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }),
    loadSellerContext(userId),
  ]);

  if (!checklist?.content?.trim() && !seller.narrative && !seller.valueProp100w) {
    return { script: FALLBACK_SCRIPT, source: "fallback" };
  }

  const prompt = `Write a first-call AGENDA-SET SCRIPT for a founder to practice delivering out loud — ONE continuous spoken passage (~60-90 seconds), with the elevator pitch INTEGRATED into the agenda, not a separate section. The beats, in order:

1. Thanks + respect for their time.
2. The proposed shape of the call: learn about their world first.
3. The context pitch, woven in naturally: "And just to provide some context, <solution name> <one-breath elevator pitch — who it's for, the core outcome, the headline proof point>" — grounded in the value prop below, using the actual product/company name from the founder's materials.
4. What happens after: map what we do to their situation, and the explicit out ("if it's not relevant, that's genuinely useful to know too").
5. CLOSE with the up-front contract confirmation + call for agreement/additions: does that work, anything else you want to make sure we cover?

Rules:
- Spoken-out-loud natural: contractions, short sentences, no corporate polish. It will be READ ALOUD and practiced from memory.
- Derive the agenda beats from the founder's first-call checklist below where it defines an opening/agenda section; otherwise use the structure above.
- Under 160 words. PLAIN TEXT ONLY — no markdown, no headers, no bullets, no bold. Just the words the founder says.
- Return ONLY the script.

${formatSellerContext(seller)}

${checklist?.content ? `## The founder's first-call checklist\n\n${checklist.content.substring(0, 8000)}` : ""}

## The buyer for context (address them naturally, e.g. by first name once)
${personaPublic.name}, ${personaPublic.title} at ${personaPublic.company.name}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
  });
  const script = (completion.choices[0]?.message?.content || "").trim();
  return script
    ? { script, source: "generated" }
    : { script: FALLBACK_SCRIPT, source: "fallback" };
}

/** Persist the founder's edited script as their reusable default. */
export async function saveDefaultAgendaScript(userId: string, script: string) {
  return prisma.gtmVariable.upsert({
    where: { userId_mergeField: { userId, mergeField: "AGENDA_SCRIPT" } },
    update: { value: script },
    create: {
      userId,
      mergeField: "AGENDA_SCRIPT",
      name: "Agenda Set Script",
      value: script,
      isDefault: false,
    },
  });
}
