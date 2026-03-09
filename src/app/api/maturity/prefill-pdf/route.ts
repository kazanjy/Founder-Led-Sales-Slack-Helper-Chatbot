import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

// Allow up to 120s for PDF processing + LLM
export const maxDuration = 120;

interface PrefillPDFRequest {
  pdfBase64: string;
  fileName: string;
}

// POST - Parse a PDF of the maturity assessment and fill questionnaire fields
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body: PrefillPDFRequest = await request.json();
    const { pdfBase64, fileName } = body;

    if (!pdfBase64) {
      return NextResponse.json(
        { error: "No PDF data provided." },
        { status: 400 }
      );
    }

    console.log(`[Maturity Prefill] Starting PDF parsing: ${fileName}`);

    // Load the maturity questions
    const questions = await prisma.maturityQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true },
    });

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "No maturity questions configured." },
        { status: 500 }
      );
    }

    // Extract text from the PDF
    const raw = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
    const buffer = Buffer.from(raw, "base64");

    const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, fileName, 30);
    const formatted = formatPDFForAIWithOCR(result, usedOCR);

    if (!formatted || formatted.includes("no extractable text")) {
      return NextResponse.json(
        { error: "Could not extract any text from the PDF. It may be image-based — try a text-based PDF export from Google Docs." },
        { status: 400 }
      );
    }

    console.log(`[Maturity Prefill] Extracted ${formatted.length} chars (OCR: ${usedOCR})`);

    // Cap context
    const MAX_CONTEXT_CHARS = 60000;
    let trimmedContext = formatted;
    if (trimmedContext.length > MAX_CONTEXT_CHARS) {
      console.warn(`[Maturity Prefill] Trimming context from ${trimmedContext.length} to ${MAX_CONTEXT_CHARS} chars`);
      trimmedContext = trimmedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for length...]";
    }

    // Build the question list for the LLM
    const questionList = questions
      .map((q) => `- ID: "${q.id}" | Q${q.globalOrder} [${q.category}]: ${q.question}`)
      .join("\n");

    const CHATBASE_LIMIT = 7500;
    const MAX_HISTORY_CHUNKS = 10;

    const instructionPrompt = `You are helping a founder fill in their GTM Maturity Assessment questionnaire. You have been given a PDF document that is a completed version of this same assessment (exported from Google Docs). Your job is to extract the answers from the PDF and map them to the correct questionnaire fields.

## QUESTIONS TO FILL

${questionList}

## INSTRUCTIONS

- Match each answer from the PDF to the correct question by understanding the content and context
- The PDF may have questions worded slightly differently — use semantic matching, not exact string matching
- Copy the answers verbatim from the PDF where possible — do not summarize or rewrite
- If a question has a long, multi-paragraph answer in the PDF, include the full answer
- If a question from the questionnaire doesn't have a corresponding answer in the PDF, use an empty string
- The PDF may contain section headers, formatting artifacts, or extra text — ignore those and focus on the Q&A content

Respond with ONLY valid JSON mapping question IDs to answer strings:
{"questionId1": "answer text...", "questionId2": "answer text...", ...}`;

    // Chunk context into Chatbase history if needed
    const chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = `${instructionPrompt}\n\n## PDF CONTENT\n\n${trimmedContext}`;

    if (finalMessage.length > CHATBASE_LIMIT) {
      const chunks: string[] = [];
      let current = "";

      const sections = trimmedContext.split(/(?=--- Page )/);
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

      if (chunks.length > MAX_HISTORY_CHUNKS) {
        console.warn(`[Maturity Prefill] Capping ${chunks.length} chunks to ${MAX_HISTORY_CHUNKS}`);
        chunks.length = MAX_HISTORY_CHUNKS;
      }

      for (let i = 0; i < chunks.length; i++) {
        chatbaseHistory.push({
          role: "user",
          content: `[Assessment PDF Content Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
        });
        if (i < chunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1} of the assessment PDF. Please continue.`,
          });
        }
      }

      finalMessage = instructionPrompt;
    }

    console.log(`[Maturity Prefill] Sending to Chatbase: ${chatbaseHistory.length} history msgs, final: ${finalMessage.length} chars`);

    // Call Chatbase
    let aiResponse: string;
    try {
      const result = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = result.response;
    } catch (err) {
      console.error("[Maturity Prefill] Chatbase error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `AI parsing failed: ${msg}` },
        { status: 500 }
      );
    }

    // Parse JSON response
    let answers: Record<string, string>;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      answers = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("[Maturity Prefill] Failed to parse AI response:", err);
      console.error("[Maturity Prefill] Raw response:", aiResponse.substring(0, 1000));
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

    console.log(`[Maturity Prefill] Filled ${filledCount} of ${questions.length} questions`);

    return NextResponse.json({
      success: true,
      answers: validAnswers,
      filledCount,
      totalQuestions: questions.length,
    });
  } catch (error) {
    console.error("[Maturity Prefill] Error:", error);
    return NextResponse.json(
      { error: "Failed to parse assessment PDF" },
      { status: 500 }
    );
  }
}

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
