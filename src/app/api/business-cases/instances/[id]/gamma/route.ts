import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { generateAndExport } from "@/lib/gamma";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";

/**
 * POST /api/business-cases/instances/[id]/gamma
 *
 * Turn a business-case artifact into a Gamma slide deck. For a
 * Discovery Summary this produces a DISCOVERY READOUT deck — the
 * "here's what we heard" presentation a founder plays back to the
 * prospect (or a champion carries internally) to validate discovery
 * and tee up next steps.
 *
 * Pipeline mirrors /api/sales-deck/generate-gamma: pre-process the
 * artifact with gpt-5.5 into slide-structured content, then
 * generateAndExport via Gamma (PDF + PPTX). Result URLs persist on
 * the instance row; regenerating overwrites them.
 */

export const maxDuration = 300;

const DISCOVERY_READOUT_DECK_PROMPT = `You are an expert B2B sales strategist. Turn the founder's Discovery Summary below into slide content for a DISCOVERY READOUT deck — the short presentation a founder plays back to the prospect to confirm "here's what we heard, here's what it's costing you, here's how we'd help, here's what's next." The audience is the prospect's team (including a champion who may forward it internally), so it must be professional, accurate, and free of internal-only commentary.

Produce 8-11 slides following this structure, flexing by how much material the summary actually contains:

1. TITLE — "Where We Are: <company> + <seller>" framing, one-line purpose.
2. YOUR WORLD TODAY — the prospect's current state as we understand it.
3. THE CHALLENGES WE HEARD — the specific pains, in their own words where the summary quotes them.
4. WHAT IT'S COSTING — quantified impact using ONLY numbers present in the summary. Where the summary shows a {{PLACEHOLDER}} or notes something isn't yet known, render it as "TBD — to validate together", never an invented figure.
5. WHY NOW — the triggers/compelling events driving this evaluation.
6. HOW WE'D HELP — the fit between their needs and our approach, from the summary's fit section.
7. WHAT WE STILL WANT TO UNDERSTAND — the open discovery questions, framed as a collaborative agenda ("help us pressure-test this"), not as gaps in our homework.
8. PROPOSED NEXT STEPS — concrete, sequenced.

Formatting rules:
- Markdown. Each slide = a ## heading, then 3-5 punchy bullets (under 15 words each), then a 1-2 sentence speaker note in *italics*, then a suggested visual in [brackets].
- Use ONLY what's in the provided materials. NEVER invent statistics, names, quotes, or commitments. Unknowns are "TBD — to validate together".
- Confident, founder-to-executive tone. No fluff slides — if the summary is thin on a section, one tight slide or skip it.
- Return ONLY the slide markdown, no preamble.`;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    const instance = await prisma.businessCaseInstance.findFirst({
      where: { id, userId: user.id },
      include: { deal: { select: { companyName: true, name: true } } },
    });
    if (!instance) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (instance.type !== "discovery_summary") {
      return NextResponse.json(
        { error: "Deck generation is only available for Discovery Summaries so far" },
        { status: 400 }
      );
    }

    // 1. Pre-process the artifact into slide-structured content. The
    // seller context grounds voice + terminology, same as everywhere.
    const seller = await loadSellerContext(user.id);
    const userContent = [
      formatSellerContext(seller),
      `## DISCOVERY SUMMARY (the source document)\n\n${instance.content}`,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n")
      .substring(0, 100_000);

    console.log(
      `[bc-gamma] instance=${instance.id} pre-processing (${userContent.length} chars)`
    );
    const pre = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: DISCOVERY_READOUT_DECK_PROMPT },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 6000,
    });
    const slideContent = pre.choices[0]?.message?.content?.trim() || "";
    if (!slideContent) {
      return NextResponse.json(
        { error: "Failed to structure the summary into slides" },
        { status: 500 }
      );
    }

    // 2. Gamma generation + export. Failures surface as errors — no
    // outline-only fallback here since the artifact itself already
    // exists; the deck is strictly additive.
    const company = instance.deal?.companyName;
    const title = company
      ? `Discovery Readout — ${company}`
      : `Discovery Readout — ${instance.title}`;
    console.log(`[bc-gamma] instance=${instance.id} starting Gamma: "${title}"`);
    const gamma = await generateAndExport({
      inputText: slideContent,
      title,
      format: "presentation",
      numCards: 10,
      tone: "Professional, collaborative, and evidence-grounded. Clean modern aesthetic.",
      theme: "professional",
    });
    console.log(
      `[bc-gamma] instance=${instance.id} done: gamma=${gamma.gammaUrl} pdf=${gamma.pdfUrl} pptx=${gamma.pptxUrl}`
    );

    const updated = await prisma.businessCaseInstance.update({
      where: { id: instance.id },
      data: {
        gammaUrl: gamma.gammaUrl,
        gammaPdfUrl: gamma.pdfUrl,
        gammaPptxUrl: gamma.pptxUrl,
        gammaGeneratedAt: new Date(),
      },
      include: { deal: { select: { id: true, name: true, companyName: true } } },
    });

    return NextResponse.json({ instance: updated });
  } catch (err) {
    console.error("[bc-gamma] failed:", err);
    const message = err instanceof Error ? err.message : "Deck generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
