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

const FALLBACK_SCRIPT = `Thanks for making the time today. I want to be respectful of the half hour, so here's what I was thinking: first, I'd love to learn a bit about how you're handling this today and what's working or not. Then I'll give you a quick picture of what we do and how teams like yours use it. If it feels relevant, we can talk about what a next step might look like — and if it doesn't, that's genuinely useful to know too. Before we dive in — anything you want to make sure we cover?

[Elevator pitch] In one line: we help {{WHO}} {{CORE OUTCOME}} without {{THE PAINFUL PART}} — teams typically see {{HEADLINE RESULT}}.`;

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

  const prompt = `Write a first-call AGENDA-SET SCRIPT for a founder to practice delivering out loud. Two parts, clearly separated:

1. THE AGENDA SET (~45-60 seconds spoken): respect for time, the proposed shape of the call (learn about them first, then a quick picture of the product, then next steps if relevant), an explicit out ("if it's not relevant, that's useful to know too"), ending with a CHECK FOR AGREEMENT ("anything you want to make sure we cover?").
2. THE ELEVATOR PITCH (~20-30 seconds spoken): the founder's one-breath answer to "so what do you do?" — who it's for, the core outcome, the headline proof point. Grounded in the value prop below.

Rules:
- Spoken-out-loud natural: contractions, short sentences, no corporate polish. It will be READ ALOUD and practiced from memory.
- Derive the agenda beats from the founder's first-call checklist below where it defines an opening/agenda section; otherwise use the classic structure above.
- Under 180 words total. Mark the two parts with "## Agenda set" and "## Elevator pitch" headers.
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
