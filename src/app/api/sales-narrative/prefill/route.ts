import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { downloadFile } from "@/lib/supabase";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

// Allow up to 120s for crawling + LLM
export const maxDuration = 120;

interface PrefillRequest {
  websiteUrl?: string;
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
    const { websiteUrl, pdfFiles } = body;

    if (!websiteUrl?.trim() && (!pdfFiles || pdfFiles.length === 0)) {
      return NextResponse.json(
        { error: "Provide a website URL and/or at least one PDF file." },
        { status: 400 }
      );
    }

    console.log(`[Prefill] Starting: websiteUrl=${websiteUrl || "none"}, PDFs=${pdfFiles?.length || 0}`);

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

    // Gather context in parallel
    const contextParts: string[] = [];
    const tasks: Promise<void>[] = [];

    // Website crawling
    if (websiteUrl?.trim()) {
      tasks.push(
        crawlWebsiteForContext(websiteUrl.trim())
          .then((text) => {
            if (text) {
              contextParts.push(`## WEBSITE CONTENT\n\n${text}`);
            }
          })
          .catch((err) => {
            console.error("[Prefill] Website crawl failed:", err);
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

    // Cap total context to prevent oversized Chatbase payloads (413 errors)
    const MAX_CONTEXT_CHARS = 40000;
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

    // Build the prompt
    const CHATBASE_LIMIT = 7500;
    const MAX_HISTORY_CHUNKS = 6; // Cap chunks to keep total payload under Chatbase limits

    const instructionPrompt = `You are helping a founder pre-fill their Founding Sales Sales Narrative questionnaire. Based on the company context provided, answer each question as thoroughly as you can.

## QUESTIONS TO ANSWER

${questionList}

## INSTRUCTIONS

- Answer each question in 2-5 sentences based on what you can infer from the context
- If you can't find information for a question, provide your best inference or leave it as an empty string
- Be specific — use actual product names, features, metrics, and customer types found in the context
- Write in first person as if the founder is answering ("We solve...", "Our customers...", "Our product...")
- For pricing, include specific numbers if found

Respond with ONLY valid JSON mapping question IDs to answer strings:
{"questionId1": "answer text...", "questionId2": "answer text...", ...}`;

    // Chunk the context into Chatbase conversation history if needed
    const chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = `${instructionPrompt}\n\n## COMPANY CONTEXT\n\n${trimmedContext}`;

    if (finalMessage.length > CHATBASE_LIMIT) {
      const chunks: string[] = [];
      let current = "";

      const sections = trimmedContext.split(/(?=## )/);
      for (const section of sections) {
        if (current.length + section.length > CHATBASE_LIMIT - 500) {
          if (current) chunks.push(current.trim());
          if (section.length > CHATBASE_LIMIT - 500) {
            const subChunks = splitTextIntoChunks(section, CHATBASE_LIMIT - 500);
            chunks.push(...subChunks);
          } else {
            current = section;
          }
        } else {
          current += section;
        }
      }
      if (current.trim()) chunks.push(current.trim());

      // Cap the number of chunks to prevent oversized Chatbase payloads
      if (chunks.length > MAX_HISTORY_CHUNKS) {
        console.warn(`[Prefill] Capping ${chunks.length} chunks to ${MAX_HISTORY_CHUNKS}`);
        chunks.length = MAX_HISTORY_CHUNKS;
      }

      for (let i = 0; i < chunks.length; i++) {
        chatbaseHistory.push({
          role: "user",
          content: `[Company Context Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
        });
        if (i < chunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1} of the company context. Please continue.`,
          });
        }
      }

      finalMessage = instructionPrompt;
    }

    console.log(`[Prefill] Sending to Chatbase: ${chatbaseHistory.length} history msgs, final: ${finalMessage.length} chars`);

    // Call Chatbase
    let aiResponse: string;
    try {
      const result = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = result.response;
    } catch (err) {
      console.error("[Prefill] Chatbase error:", err);
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
    });
  } catch (error) {
    console.error("[Prefill] Error:", error);
    return NextResponse.json(
      { error: "Failed to pre-fill narrative" },
      { status: 500 }
    );
  }
}

/**
 * Split a large text into chunks of roughly maxLen characters at paragraph boundaries.
 */
function splitTextIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLen) {
      if (current) chunks.push(current.trim());
      if (para.length > maxLen) {
        for (let i = 0; i < para.length; i += maxLen) {
          chunks.push(para.substring(i, i + maxLen));
        }
        current = "";
      } else {
        current = para;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}
