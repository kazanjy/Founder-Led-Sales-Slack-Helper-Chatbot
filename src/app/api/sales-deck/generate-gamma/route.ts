import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { generateAndExport } from "@/lib/gamma";
import { fetchPage } from "@/lib/search/fetcher";
import { extractTextFromPDFWithOCR } from "@/lib/pdf-server";
import { createSequenceConversation } from "@/lib/sequences/sequence-conversation";

// Allow up to 300s for the full pipeline (scraping + pre-processing + Gamma + export)
export const maxDuration = 300;

/**
 * POST /api/sales-deck/generate-gamma
 *
 * Full Gamma deck generation pipeline:
 * 1. Fetch sales narrative (parent)
 * 2. Scrape content from user-provided URLs
 * 3. Parse user-uploaded PDFs
 * 4. Pre-process all content with GPT-5 using Founding Sales guidelines
 * 5. Generate presentation via Gamma API
 * 6. Export to PDF + PPTX
 * 7. Save SalesDeckVersion
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const {
      orgPersona,
      humanPersona,
      specialNotes,
      prospectUrl,
      contextUrls = [] as string[],
      brandAnalysis,
      // PDFs are passed as pre-parsed text (parsed client-side via /api/sales-deck/parse-pdf)
      contextPdfTexts = [] as Array<{ fileName: string; text: string }>,
    } = body;

    console.log(`[generate-gamma] Request from user ${user.id}: orgPersona="${orgPersona?.substring(0, 60)}...", humanPersona="${humanPersona?.substring(0, 60)}...", prospectUrl=${prospectUrl || "none"}, contextUrls=${contextUrls.length}, contextPdfs=${contextPdfTexts.length}, hasBrandAnalysis=${!!brandAnalysis}, hasSpecialNotes=${!!specialNotes}`);

    if (!orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Organization persona and target role are required" },
        { status: 400 }
      );
    }

    // 1. Fetch the latest sales narrative
    const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestNarrative) {
      return NextResponse.json(
        { error: "No sales narrative found. Please create a sales narrative first." },
        { status: 400 }
      );
    }

    // 2. Scrape content from context URLs (in parallel)
    console.log(`[generate-gamma] Scraping ${contextUrls.length} context URLs`);
    const urlContents: string[] = [];
    if (contextUrls.length > 0) {
      const fetchResults = await Promise.allSettled(
        contextUrls.map((url: string) => fetchPage(url.startsWith("http") ? url : `https://${url}`, "Context"))
      );

      for (const result of fetchResults) {
        if (result.status === "fulfilled" && result.value.success && result.value.textContent) {
          const page = result.value;
          urlContents.push(`=== ${page.title || page.url} (${page.url}) ===\n${page.textContent}`);
        }
      }
      console.log(`[generate-gamma] Scraped ${urlContents.length}/${contextUrls.length} URLs successfully`);
    }

    // 3. Collect PDF texts
    const pdfContents: string[] = [];
    for (const pdf of contextPdfTexts) {
      if (pdf.text) {
        pdfContents.push(`=== PDF: ${pdf.fileName} ===\n${pdf.text}`);
      }
    }
    console.log(`[generate-gamma] ${pdfContents.length} PDF context documents`);

    // 4. Build the pre-processing prompt
    const allContext = buildPreProcessingContext({
      salesNarrative: latestNarrative.narrative,
      urlContents,
      pdfContents,
      orgPersona,
      humanPersona,
      specialNotes,
      brandAnalysis,
    });

    // 5. Pre-process with GPT-5 to produce structured slide content
    console.log(`[generate-gamma] Pre-processing with GPT-5 (${allContext.length} chars)`);
    const preProcessResponse = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: FOUNDING_SALES_DECK_PROMPT,
        },
        {
          role: "user",
          content: allContext,
        },
      ],
      max_completion_tokens: 8000,
      temperature: 0.7,
    });

    const structuredSlideContent = preProcessResponse.choices[0]?.message?.content?.trim() || "";
    if (!structuredSlideContent) {
      return NextResponse.json(
        { error: "Failed to generate slide content from your materials." },
        { status: 500 }
      );
    }
    console.log(`[generate-gamma] Pre-processing complete: ${structuredSlideContent.length} chars`);

    // 6. Generate presentation via Gamma + export to PDF/PPTX
    const deckTitle = `Sales Deck: ${orgPersona}`;
    const tone = brandAnalysis
      ? extractToneFromBrandAnalysis(brandAnalysis)
      : "Professional, confident, and data-driven. Clean modern aesthetic with clear visual hierarchy.";
    console.log(`[generate-gamma] Starting Gamma pipeline: title="${deckTitle}", tone="${tone.substring(0, 80)}...", inputLength=${structuredSlideContent.length}`);
    let gammaResult;
    try {
      gammaResult = await generateAndExport({
        inputText: structuredSlideContent,
        title: deckTitle,
        format: "presentation",
        numCards: 14,
        tone,
        theme: "professional",
      });
      console.log(`[generate-gamma] Gamma pipeline succeeded: gammaUrl=${gammaResult.gammaUrl}, pdfUrl=${gammaResult.pdfUrl}, pptxUrl=${gammaResult.pptxUrl}`);
    } catch (gammaError) {
      console.error("[generate-gamma] Gamma pipeline FAILED:", gammaError instanceof Error ? gammaError.message : gammaError);
      console.error("[generate-gamma] Full Gamma error:", gammaError);
      console.log("[generate-gamma] Saving version with outline only (no Gamma presentation)");
      const version = await saveDeckVersion({
        userId: user.id,
        narrativeId: latestNarrative.id,
        orgPersona,
        humanPersona,
        specialNotes,
        prospectUrl,
        contextUrls,
        contextPdfNames: contextPdfTexts.map((p: { fileName: string }) => p.fileName),
        brandAnalysis,
        content: structuredSlideContent,
        gammaInputContent: structuredSlideContent,
        gammaUrl: null,
        gammaPdfUrl: null,
        gammaPptxUrl: null,
      });

      // Create linked conversation
      const conversation = await createLinkedConversation(user.id, version, orgPersona, humanPersona, specialNotes, structuredSlideContent);
      await prisma.salesDeckVersion.update({
        where: { id: version.id },
        data: { conversationId: conversation.id },
      });

      console.log(`[generate-gamma] Saved outline-only version ${version.id} (gammaFailed=true)`);
      return NextResponse.json({
        success: true,
        gammaFailed: true,
        version: {
          ...formatVersion(version),
          conversationId: conversation.id,
        },
      });
    }

    // 7. Save to DB
    const version = await saveDeckVersion({
      userId: user.id,
      narrativeId: latestNarrative.id,
      orgPersona,
      humanPersona,
      specialNotes,
      prospectUrl,
      contextUrls,
      contextPdfNames: contextPdfTexts.map((p: { fileName: string }) => p.fileName),
      brandAnalysis,
      content: structuredSlideContent,
      gammaInputContent: structuredSlideContent,
      gammaUrl: gammaResult.gammaUrl,
      gammaPdfUrl: gammaResult.pdfUrl,
      gammaPptxUrl: gammaResult.pptxUrl,
    });

    // Create linked conversation
    const conversation = await createLinkedConversation(user.id, version, orgPersona, humanPersona, specialNotes, structuredSlideContent);
    await prisma.salesDeckVersion.update({
      where: { id: version.id },
      data: { conversationId: conversation.id },
    });

    // Update GTM merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "SALES_DECK",
        },
      },
      update: { value: structuredSlideContent },
      create: {
        userId: user.id,
        mergeField: "SALES_DECK",
        name: "Sales Deck",
        value: structuredSlideContent,
        isDefault: false,
      },
    });

    console.log(`[generate-gamma] Complete! Version: ${version.id}, Gamma: ${gammaResult.gammaUrl}`);

    return NextResponse.json({
      success: true,
      version: {
        ...formatVersion(version),
        conversationId: conversation.id,
        gammaUrl: gammaResult.gammaUrl,
        gammaPdfUrl: gammaResult.pdfUrl,
        gammaPptxUrl: gammaResult.pptxUrl,
      },
    });
  } catch (error) {
    console.error("[generate-gamma] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate sales deck presentation" },
      { status: 500 }
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────

interface SaveDeckParams {
  userId: string;
  narrativeId: string;
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string;
  prospectUrl?: string;
  contextUrls: string[];
  contextPdfNames: string[];
  brandAnalysis?: string;
  content: string;
  gammaInputContent: string;
  gammaUrl: string | null;
  gammaPdfUrl: string | null;
  gammaPptxUrl: string | null;
}

async function saveDeckVersion(params: SaveDeckParams) {
  return prisma.salesDeckVersion.create({
    data: {
      userId: params.userId,
      salesNarrativeVersionId: params.narrativeId,
      orgPersona: params.orgPersona,
      humanPersona: params.humanPersona,
      specialNotes: params.specialNotes || null,
      deckMode: "gamma",
      content: params.content,
      prospectUrl: params.prospectUrl || null,
      contextUrls: params.contextUrls,
      contextPdfNames: params.contextPdfNames,
      brandAnalysis: params.brandAnalysis || null,
      gammaInputContent: params.gammaInputContent,
      gammaUrl: params.gammaUrl,
      gammaPdfUrl: params.gammaPdfUrl,
      gammaPptxUrl: params.gammaPptxUrl,
    },
  });
}

function formatVersion(version: { id: string; content: string; orgPersona: string; humanPersona: string; specialNotes: string | null; deckMode: string; prospectUrl: string | null; contextUrls: string[]; contextPdfNames: string[]; brandAnalysis: string | null; gammaUrl: string | null; gammaPdfUrl: string | null; gammaPptxUrl: string | null; gammaInputContent: string | null; salesNarrativeVersionId: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: version.id,
    content: version.content,
    orgPersona: version.orgPersona,
    humanPersona: version.humanPersona,
    specialNotes: version.specialNotes,
    deckMode: version.deckMode,
    prospectUrl: version.prospectUrl,
    contextUrls: version.contextUrls,
    contextPdfNames: version.contextPdfNames,
    brandAnalysis: version.brandAnalysis,
    gammaUrl: version.gammaUrl,
    gammaPdfUrl: version.gammaPdfUrl,
    gammaPptxUrl: version.gammaPptxUrl,
    salesNarrativeVersionId: version.salesNarrativeVersionId,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

async function createLinkedConversation(
  userId: string,
  version: { id: string },
  orgPersona: string,
  humanPersona: string,
  specialNotes: string | undefined,
  content: string
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
  const reportUrl = `${appUrl}/sales-deck?version=${version.id}`;

  return createSequenceConversation({
    userId,
    sequenceType: "sales-deck",
    orgPersona,
    humanPersona,
    specialNotes,
    content,
    reportUrl,
  });
}

/**
 * Extract the tone recommendation from the brand analysis text.
 */
function extractToneFromBrandAnalysis(brandAnalysis: string): string {
  // Try to find the "Presentation Tone Recommendation" section
  const toneMatch = brandAnalysis.match(
    /(?:Presentation Tone Recommendation|Tone Recommendation)[:\s]*\n+([\s\S]*?)(?:\n##|\n\n\n|$)/i
  );
  if (toneMatch?.[1]) {
    return toneMatch[1].trim().substring(0, 500);
  }
  // Fallback: use the whole brand analysis (truncated)
  return brandAnalysis.substring(0, 500);
}

/**
 * Build the full context string for the pre-processing prompt.
 */
function buildPreProcessingContext(params: {
  salesNarrative: string;
  urlContents: string[];
  pdfContents: string[];
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string;
  brandAnalysis?: string;
}): string {
  const sections: string[] = [];

  sections.push(`## TARGET PERSONA

- **Organization type:** ${params.orgPersona}
- **Target role:** ${params.humanPersona}
${params.specialNotes ? `- **Special notes:** ${params.specialNotes}` : ""}`);

  sections.push(`## SALES NARRATIVE

${params.salesNarrative}`);

  if (params.urlContents.length > 0) {
    sections.push(`## ADDITIONAL CONTEXT FROM URLS

${params.urlContents.join("\n\n")}`);
  }

  if (params.pdfContents.length > 0) {
    sections.push(`## ADDITIONAL CONTEXT FROM UPLOADED DOCUMENTS

${params.pdfContents.join("\n\n")}`);
  }

  if (params.brandAnalysis) {
    sections.push(`## PROSPECT BRAND ANALYSIS

${params.brandAnalysis}`);
  }

  // Truncate total context if it's extremely long
  const combined = sections.join("\n\n---\n\n");
  const MAX_CONTEXT = 100000;
  if (combined.length > MAX_CONTEXT) {
    return combined.substring(0, MAX_CONTEXT) + "\n\n[...context truncated for length...]";
  }
  return combined;
}

// ── Founding Sales Deck Pre-Processing Prompt ──────────────────

const FOUNDING_SALES_DECK_PROMPT = `You are an expert B2B sales deck strategist trained on the Founding Sales methodology. Your job is to take all provided context (sales narrative, scraped web content, uploaded documents) and produce structured slide content for a sales presentation that follows the Founding Sales deck framework.

## YOUR TASK

Produce a complete sales deck outline with 10-15 slides. Each slide should have:
- A clear **slide title**
- **Bullet points / key content** for the slide body
- A brief **speaker note** (1-2 sentences of what to say)

The content should be ready to be turned into a visual presentation. Write for SLIDES, not a document — keep text concise, punchy, and visual-friendly.

## FOUNDING SALES DECK STRUCTURE

Follow this structure, flexing the number of slides per section based on how much relevant content is available:

### 1. THE PROBLEM AND WHO HAS IT (1-2 slides)
Start by clearly defining the problem and who experiences it. Reinforce the problem with evidence: industry stats, analyst reports, or real-world anecdotes from the provided context. The goal is to show this is a widespread, validated issue — not just an opinion. If there are specific data points from the URLs or documents, use them.

### 2. THE COST OF THE PROBLEM (1 slide)
Quantify the impact. Show how the problem translates into lost revenue, inefficiency, or operational risk. Use concrete metrics:
- Cost per employee or per month
- Lost deals or missed opportunities
- Time wasted or productivity loss
Make the financial impact easy to map to the prospect's business.

### 3. EXISTING SOLUTIONS AND THEIR CHALLENGES (1-2 slides)
Acknowledge current approaches without over-focusing on competitors. Group them into categories and highlight their shortcomings:
- Where they break down
- Why they fail at scale
- What they miss relative to key business metrics
Only go deep on specific competitors if the provided context indicates they are widely used or strategically important.

### 4. WHAT'S CHANGED (1 slide)
Explain why this problem matters NOW. Highlight shifts in technology, market dynamics, or user behavior that create urgency. Use a simple narrative (a timeline works well) to align the prospect's understanding. This is your "why now?" moment.

### 5. HOW OUR SOLUTION WORKS (2-3 slides)
Provide a clear conceptual model BEFORE diving into features. Use the first slide to establish the high-level "how" (an analogy or diagram description works well), then use subsequent slides for specific capabilities. If helpful, contrast with existing solutions to clarify differentiation.

### 6. QUANTITATIVE PROOF OF BETTER SOLUTION (1-2 slides)
Answer "why this over the status quo?" with measurable improvements:
- Revenue increase, cost reduction, efficiency gains
- Superior metrics compared to industry standards
- ROI data, benchmark comparisons
Tie proof directly to the metrics the target persona cares about. Pull specific numbers from the provided context whenever available.

### 7. QUALITATIVE PROOF OF BETTER SOLUTION (1 slide)
Customer stories, testimonials, use cases. Include company logos if mentioned in the context. Customer success examples should correlate to value proposition buckets. If the context includes case studies or customer quotes, feature them here.

### 8. WHY THIS WILL BE SO EASY (1 slide)
Reduce perceived risk. Show that implementation is fast, supported, and low-friction. Address concerns around time, complexity, and disruption upfront. Include specific onboarding details if available in the context.

### 9. PRICING (1 slide)
Present pricing clearly and simply. If multiple tiers exist, guide toward the recommended package. If pricing isn't in the provided context, create a placeholder slide noting "Pricing discussion" with typical B2B pricing framework.

### 10. APPENDIX (optional, 1-2 slides)
Only include if the context contains strong material for:
- Detailed competitive comparisons
- Technical integration details
- Additional case studies or ROI calculators

## FORMATTING RULES

- Use markdown formatting for the output
- Each slide should be a ## heading with the slide title
- Use bullet points for slide body content (keep each bullet under 15 words for slide-readability)
- Speaker notes should be in *italics* below the bullets
- Include a suggested visual description in [brackets] for each slide
- Target 10-15 slides total — don't pad with weak content, don't skip sections with strong content
- Write in a confident, founder-to-executive tone — conversational but authoritative
- Every slide should earn the right to show the next one

## IMPORTANT

- Use ALL provided context: sales narrative, URL content, PDF content
- Prefer specific data points and examples over generic statements
- If the context is thin on a particular section, keep that section to 1 slide with what's available
- Do NOT make up statistics or customer names — only use what's in the provided materials
- If no pricing information is available, include a placeholder pricing slide framework`;
