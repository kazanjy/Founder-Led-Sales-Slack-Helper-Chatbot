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
 * Streams answers one-by-one via SSE as the LLM generates them.
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
              const { result: text } = await extractTextFromPDFWithOCR(buffer, pdf.name, 30);
              if (text?.trim()) {
                const formatted = formatPDFForAIWithOCR(text, pdf.name);
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

    // Build prompt with delimiter-based output format for streaming
    const questionList = questions
      .map((q) => {
        const help = q.helpText ? ` (${q.helpText})` : "";
        return `- ID: "${q.id}" | Q${q.globalOrder} [${q.category}]: ${q.question}${help}`;
      })
      .join("\n");

    const fullPrompt = `You are helping a founder pre-fill their Sales Narrative questionnaire.

## QUESTIONS TO ANSWER

${questionList}

## INSTRUCTIONS

- Write RICH, DETAILED answers — 3-8 sentences per question
- Pull in EVERY relevant detail: product names, metrics, customer names, competitive differentiators
- Write in first person ("We solve...", "Our customers...")
- If you can't find info for a question, write an empty answer

## OUTPUT FORMAT

Output each answer using this EXACT delimiter format. Each answer MUST start with ===ANSWER:questionId=== on its own line, followed by the answer text, then ===END=== on its own line.

Example:
===ANSWER:abc123===
We solve the problem of technical recruiting by aggregating professional activity data from across the web.
===END===
===ANSWER:def456===
Our primary customers are technical recruiters and sourcers at technology companies.
===END===

Answer ALL questions in order. Start each with ===ANSWER:id=== and end with ===END===.

## COMPANY CONTEXT

${trimmedContext}`;

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

          // Stream the LLM response
          const llmStream = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [{ role: "user", content: fullPrompt }],
            temperature: 0.7,
            stream: true,
          });

          let buffer = "";
          let currentQuestionId: string | null = null;
          let currentAnswer = "";
          const validIds = new Set(questions.map((q) => q.id));

          for await (const chunk of llmStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (!token) continue;
            buffer += token;

            // Parse delimiter-based answers from buffer
            while (true) {
              if (!currentQuestionId) {
                // Look for ===ANSWER:id===
                const startMatch = buffer.match(/===ANSWER:([^=]+)===/);
                if (!startMatch) break;
                currentQuestionId = startMatch[1].trim();
                currentAnswer = "";
                buffer = buffer.substring(buffer.indexOf(startMatch[0]) + startMatch[0].length);
              } else {
                // Look for ===END===
                const endIdx = buffer.indexOf("===END===");
                if (endIdx === -1) {
                  // Accumulate partial answer
                  currentAnswer += buffer;
                  buffer = "";
                  break;
                }
                // Complete answer found
                currentAnswer += buffer.substring(0, endIdx);
                buffer = buffer.substring(endIdx + "===END===".length);

                const trimmed = currentAnswer.trim();
                if (validIds.has(currentQuestionId) && trimmed) {
                  send("answer", { questionId: currentQuestionId, answer: trimmed });
                }
                currentQuestionId = null;
                currentAnswer = "";
              }
            }
          }

          send("complete", {
            totalQuestions: questions.length,
          });
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
