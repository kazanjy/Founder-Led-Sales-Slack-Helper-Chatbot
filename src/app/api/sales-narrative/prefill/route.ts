import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { fetchPages } from "@/lib/search/fetcher";
import { downloadFile } from "@/lib/supabase";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

// Allow up to 120s for crawling + LLM
export const maxDuration = 120;

interface PrefillRequest {
  websiteUrl?: string;
  specificUrls?: string[];
  pdfFiles?: { name: string; storagePath?: string; base64Data?: string }[];
}

// POST - Pre-fill sales narrative Q&A from website URL and/or uploaded PDFs
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body: PrefillRequest = await request.json();
    const { websiteUrl, specificUrls, pdfFiles } = body;

    const hasSpecificUrls = specificUrls && specificUrls.filter((u) => u.trim()).length > 0;

    if (!websiteUrl?.trim() && !hasSpecificUrls && (!pdfFiles || pdfFiles.length === 0)) {
      return NextResponse.json(
        { error: "Provide a website URL, specific page URLs, and/or at least one PDF file." },
        { status: 400 }
      );
    }

    console.log(`[Prefill] Starting: websiteUrl=${websiteUrl || "none"}, specificUrls=${hasSpecificUrls ? specificUrls!.length : 0}, PDFs=${pdfFiles?.length || 0}`);

    // Load the questions we need to answer
    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true, helpText: true },
    });

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "No narrative questions configured." },
        { status: 500 }
      );
    }

    // Gather context in parallel, tracking sources
    const contextParts: string[] = [];
    const sourceUrls: string[] = [];
    const sourcePdfNames: string[] = [];
    const tasks: Promise<void>[] = [];

    // Website crawling (two-level crawl)
    if (websiteUrl?.trim()) {
      tasks.push(
        crawlWebsiteForContext(websiteUrl.trim())
          .then((result) => {
            if (result.text) {
              contextParts.push(`## WEBSITE CONTENT\n\n${result.text}`);
              sourceUrls.push(...result.urls);
            }
          })
          .catch((err) => {
            console.error("[Prefill] Website crawl failed:", err);
          })
      );
    }

    // Specific page URL fetching (single-page, no crawl)
    if (hasSpecificUrls) {
      const cleanUrls = specificUrls!.filter((u) => u.trim()).map((u) => {
        const trimmed = u.trim();
        return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
      });
      tasks.push(
        fetchPages(
          cleanUrls.map((u) => ({ url: u, purpose: "specific-page" })),
          5
        )
          .then((pages) => {
            const successPages = pages.filter((p) => p.success && p.textContent);
            if (successPages.length > 0) {
              const combined = successPages
                .map((p) => `### ${p.title || p.url}\n${p.textContent}`)
                .join("\n\n---\n\n");
              contextParts.push(`## SPECIFIC PAGE CONTENT\n\n${combined}`);
              sourceUrls.push(...successPages.map((p) => p.url));
            }
            const failedPages = pages.filter((p) => !p.success);
            if (failedPages.length > 0) {
              console.warn(`[Prefill] ${failedPages.length} specific URL(s) failed to fetch`);
            }
          })
          .catch((err) => {
            console.error("[Prefill] Specific URL fetch failed:", err);
          })
      );
    }

    // PDF processing — accept base64 data directly (like chat) or download from Supabase
    if (pdfFiles) {
      for (const pdf of pdfFiles) {
        tasks.push(
          (async () => {
            try {
              let buffer: Buffer;
              if (pdf.base64Data) {
                // Base64 sent directly from client (same pattern as chat uploads)
                const raw = pdf.base64Data.includes(",")
                  ? pdf.base64Data.split(",")[1]
                  : pdf.base64Data;
                buffer = Buffer.from(raw, "base64");
              } else if (pdf.storagePath) {
                buffer = await downloadFile(pdf.storagePath);
              } else {
                console.error(`[Prefill] PDF ${pdf.name}: no data or storagePath`);
                return;
              }
              const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, pdf.name, 30);
              const formatted = formatPDFForAIWithOCR(result, usedOCR);
              if (formatted) {
                contextParts.push(`## PDF: ${pdf.name}\n\n${formatted}`);
                sourcePdfNames.push(pdf.name);
              }
            } catch (err) {
              console.error(`[Prefill] Failed to process PDF ${pdf.name}:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(tasks);

    const combinedContext = contextParts.join("\n\n---\n\n");

    if (!combinedContext.trim()) {
      return NextResponse.json(
        { error: "Could not extract any content from the provided materials." },
        { status: 400 }
      );
    }

    // Cap total context to stay within reasonable token limits
    const MAX_CONTEXT_CHARS = 120000;
    let trimmedContext = combinedContext;
    if (trimmedContext.length > MAX_CONTEXT_CHARS) {
      console.warn(`[Prefill] Trimming context from ${trimmedContext.length} to ${MAX_CONTEXT_CHARS} chars`);
      trimmedContext = trimmedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for length...]";
    }

    console.log(`[Prefill] Total context: ${trimmedContext.length} chars from ${contextParts.length} sources`);

    // Build the question list for the LLM
    const questionList = questions
      .map((q) => {
        const help = q.helpText ? ` (${q.helpText})` : "";
        return `- ID: "${q.id}" | Q${q.globalOrder} [${q.category}]: ${q.question}${help}`;
      })
      .join("\n");

    // Build the full prompt (GPT-5.2 has large context — no chunking needed)
    const fullPrompt = `You are helping a founder pre-fill their Sales Narrative questionnaire. Based on the company context provided, answer each question as thoroughly and completely as you can. Use ALL the relevant information from the context — do not summarize or leave out details.

## QUESTIONS TO ANSWER

${questionList}

## INSTRUCTIONS

- Write RICH, DETAILED answers — aim for 3-8 sentences per question. More detail is always better.
- Pull in EVERY relevant detail from the context: specific product names, feature names, metrics, customer names, use cases, integrations, ROI figures, quotes, and competitive differentiators
- For "Who has the problem?" — list ALL organizational personas and human personas you can identify from the context, with specifics about each
- For "How do people currently solve this problem?" — enumerate every alternative/competitor mentioned and how each falls short
- For "How do you know it's better?" — include ALL proof points: customer quotes, metrics, case study results, awards, and third-party validation found in the context
- For pricing — include specific tiers, plans, and numbers if found
- If the context contains customer stories or case studies, weave those specifics into relevant answers
- Write in first person as if the founder is answering ("We solve...", "Our customers...", "Our product...")
- If you truly can't find information for a question, provide your best inference or leave it as an empty string
- Do NOT be brief — the founder wants comprehensive draft answers they can edit down, not thin summaries they have to expand

Respond with ONLY valid JSON mapping question IDs to answer strings:
{"questionId1": "answer text...", "questionId2": "answer text...", ...}

## COMPANY CONTEXT

${trimmedContext}`;

    console.log(`[Prefill] Sending to GPT-5.2: ${fullPrompt.length} chars`);

    // Call GPT-5.2
    let aiResponse: string;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.7,
      });
      aiResponse = response.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[Prefill] GPT-5.2 error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `AI generation failed: ${msg}` },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let answers: Record<string, string>;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      answers = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("[Prefill] Failed to parse AI response:", err);
      console.error("[Prefill] Raw response:", aiResponse.substring(0, 1000));
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again." },
        { status: 500 }
      );
    }

    // Validate: only include answers for known question IDs
    const validIds = new Set(questions.map((q) => q.id));
    const validAnswers: Record<string, string> = {};
    let filledCount = 0;

    for (const [id, answer] of Object.entries(answers)) {
      if (validIds.has(id) && typeof answer === "string" && answer.trim()) {
        validAnswers[id] = answer.trim();
        filledCount++;
      }
    }

    console.log(`[Prefill] Pre-filled ${filledCount} of ${questions.length} questions`);

    return NextResponse.json({
      success: true,
      answers: validAnswers,
      filledCount,
      totalQuestions: questions.length,
      sourceUrls,
      sourcePdfNames,
    });
  } catch (error) {
    console.error("[Prefill] Error:", error);
    return NextResponse.json(
      { error: "Failed to pre-fill narrative" },
      { status: 500 }
    );
  }
}
