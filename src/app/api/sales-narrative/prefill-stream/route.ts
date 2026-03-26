import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { fetchPages } from "@/lib/search/fetcher";
import { downloadFile } from "@/lib/supabase";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

export const maxDuration = 120;

interface PrefillRequest {
  websiteUrl?: string;
  specificUrls?: string[];
  pdfFiles?: { name: string; storagePath?: string }[];
  cachedCrawl?: { text: string; urls: string[] };
}

/**
 * POST /api/sales-narrative/prefill-stream
 * Uses the same proven JSON prompt as the regular prefill endpoint,
 * but sends each answer as an SSE event so the client can fill
 * fields one at a time.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const body: PrefillRequest = await request.json();
    const { websiteUrl, specificUrls, pdfFiles, cachedCrawl } = body;
    const hasSpecificUrls = specificUrls && specificUrls.filter((u) => u.trim()).length > 0;

    if (!websiteUrl?.trim() && !hasSpecificUrls && (!pdfFiles || pdfFiles.length === 0) && !cachedCrawl?.text) {
      return new Response(JSON.stringify({ error: "No materials provided" }), { status: 400 });
    }

    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true, helpText: true },
    });

    if (questions.length === 0) {
      return new Response(JSON.stringify({ error: "No questions configured" }), { status: 500 });
    }

    // Gather context (same logic as prefill route)
    const contextParts: string[] = [];
    const sourceUrls: string[] = [];
    const sourcePdfNames: string[] = [];
    const tasks: Promise<void>[] = [];

    if (cachedCrawl?.text) {
      contextParts.push(`## WEBSITE CONTENT\n\n${cachedCrawl.text}`);
      sourceUrls.push(...cachedCrawl.urls);
    } else if (websiteUrl?.trim()) {
      tasks.push(
        crawlWebsiteForContext(websiteUrl.trim())
          .then((result) => {
            if (result.text) {
              contextParts.push(`## WEBSITE CONTENT\n\n${result.text}`);
              sourceUrls.push(...result.urls);
            }
          })
          .catch((err) => console.error("[PrefillStream] Crawl failed:", err))
      );
    }

    if (hasSpecificUrls) {
      const cleanUrls = specificUrls!.filter((u) => u.trim()).map((u) => {
        const t = u.trim();
        return t.startsWith("http") ? t : `https://${t}`;
      });
      tasks.push(
        fetchPages(cleanUrls.map((u) => ({ url: u, purpose: "specific-page" })), 10)
          .then((pages) => {
            const ok = pages.filter((p) => p.success && p.textContent);
            if (ok.length > 0) {
              contextParts.push(`## SPECIFIC PAGE CONTENT\n\n${ok.map((p) => `### ${p.title || p.url}\n${p.textContent}`).join("\n\n---\n\n")}`);
              sourceUrls.push(...ok.map((p) => p.url));
            }
          })
          .catch((err) => console.error("[PrefillStream] URL fetch failed:", err))
      );
    }

    if (pdfFiles && pdfFiles.length > 0) {
      for (const pdf of pdfFiles) {
        tasks.push(
          (async () => {
            try {
              if (!pdf.storagePath) return;
              const buffer = await downloadFile(pdf.storagePath);
              if (!buffer) return;
              const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, pdf.name, 30);
              const formatted = formatPDFForAIWithOCR(result, usedOCR);
              if (formatted) {
                contextParts.push(`## PDF: ${pdf.name}\n\n${formatted}`);
                sourcePdfNames.push(pdf.name);
              }
            } catch (err) {
              console.error(`[PrefillStream] PDF ${pdf.name} failed:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(tasks);
    const combinedContext = contextParts.join("\n\n---\n\n");

    if (!combinedContext.trim()) {
      return new Response(JSON.stringify({ error: "Could not extract content" }), { status: 400 });
    }

    const MAX_CONTEXT_CHARS = 120000;
    const trimmedContext = combinedContext.length > MAX_CONTEXT_CHARS
      ? combinedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated...]"
      : combinedContext;

    // Set up SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          // Send source info immediately
          send("sources", { sourceUrls, sourcePdfNames });

          console.log(`[PrefillStream] Firing ${questions.length} parallel LLM calls`);

          // Fire one LLM call per question — all in parallel
          const promises = questions.map(async (q) => {
            const help = q.helpText ? `\nHint: ${q.helpText}` : "";
            const prompt = `You are helping a founder pre-fill their Sales Narrative questionnaire. Based on the company context below, answer this ONE question as thoroughly and completely as you can.

## QUESTION
Q${q.globalOrder} [${q.category}]: ${q.question}${help}

## INSTRUCTIONS
- Write a RICH, DETAILED answer — aim for 3-8 sentences
- Pull in EVERY relevant detail: product names, features, metrics, customer names, use cases, competitive differentiators
- Write in first person as if the founder is answering ("We solve...", "Our customers...", "Our product...")
- If you truly can't find information, provide your best inference based on context
- Do NOT be brief — provide a comprehensive draft the founder can edit down

## COMPANY CONTEXT

${trimmedContext}

Respond with ONLY the answer text. No JSON, no quotes, no preamble, no markdown formatting (no ** or # or bullets).`;

            try {
              const response = await openai.chat.completions.create({
                model: "gpt-5.2",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
              });

              const answer = (response.choices[0]?.message?.content || "").trim();
              if (answer) {
                send("answer", { questionId: q.id, answer });
                console.log(`[PrefillStream] Q${q.globalOrder} done (${answer.length} chars)`);
              }
            } catch (err) {
              console.error(`[PrefillStream] Q${q.globalOrder} failed:`, err);
            }
          });

          await Promise.all(promises);
          send("complete", { totalQuestions: questions.length });
        } catch (error) {
          console.error("[PrefillStream] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Prefill failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[PrefillStream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start prefill" }), { status: 500 });
  }
}
