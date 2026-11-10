import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
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

    // Cap context for the LLM
    const MAX_CONTEXT_CHARS = 100000;
    let trimmedContext = formatted;
    if (trimmedContext.length > MAX_CONTEXT_CHARS) {
      console.warn(`[Maturity Prefill] Trimming context from ${trimmedContext.length} to ${MAX_CONTEXT_CHARS} chars`);
      trimmedContext = trimmedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for length...]";
    }

    // Build the question list for the LLM
    const questionList = questions
      .map((q) => `- ID: "${q.id}" | Q${q.globalOrder} [${q.category}]: ${q.question}`)
      .join("\n");

    const systemPrompt = `You are helping a founder fill in their GTM Maturity Assessment questionnaire. You have been given a PDF document that is a completed version of this same assessment (exported from Google Docs). Your job is to extract the answers from the PDF and map them to the correct questionnaire fields.

## QUESTIONS TO FILL

${questionList}

## INSTRUCTIONS

- Match each answer from the PDF to the correct question by understanding the content and context
- The PDF may have questions worded slightly differently — use semantic matching, not exact string matching
- Copy the answers verbatim from the PDF where possible — do not summarize or rewrite
- If a question has a long, multi-paragraph answer in the PDF, include the full answer
- If a question from the questionnaire doesn't have a corresponding answer in the PDF, use an empty string
- The PDF may contain section headers, formatting artifacts, or extra text — ignore those and focus on the Q&A content

You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation.
Format: {"questionId1": "answer text...", "questionId2": "answer text...", ...}`;

    console.log(`[Maturity Prefill] Sending to GPT-5.2: system ${systemPrompt.length} chars, user ${trimmedContext.length} chars`);

    // Call GPT-5.2 directly — no Chatbase message limits
    let aiResponse: string;
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `## PDF CONTENT\n\n${trimmedContext}` },
        ],
        response_format: { type: "json_object" },
      });

      aiResponse = completion.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[Maturity Prefill] OpenAI error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `AI parsing failed: ${msg}` },
        { status: 500 }
      );
    }

    // Parse JSON response
    let answers: Record<string, string>;
    try {
      answers = JSON.parse(aiResponse);
    } catch (err) {
      // Fallback: try to extract JSON from response
      try {
        let cleaned = aiResponse.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
        const startIdx = cleaned.indexOf("{");
        if (startIdx === -1) throw new Error("No JSON object found in response");

        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < cleaned.length; i++) {
          if (cleaned[i] === "{") depth++;
          else if (cleaned[i] === "}") {
            depth--;
            if (depth === 0) { endIdx = i; break; }
          }
        }
        if (endIdx === -1) throw new Error("Unbalanced JSON — response may have been truncated");
        answers = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
      } catch (fallbackErr) {
        console.error("[Maturity Prefill] Failed to parse AI response:", fallbackErr);
        console.error("[Maturity Prefill] Raw response (first 1500 chars):", aiResponse.substring(0, 1500));
        return NextResponse.json(
          { error: "Failed to parse AI response. The AI may have returned a malformed response — please try again." },
          { status: 500 }
        );
      }
    }

    // Validate: only include answers for known question IDs
    // Filter out placeholder non-answers (e.g. "Answer" left unchanged in the Google Doc)
    const placeholderAnswers = new Set(["answer", "n/a", "na", "none", "tbd", "todo", "?"]);
    const validIds = new Set(questions.map((q) => q.id));
    const validAnswers: Record<string, string> = {};
    let filledCount = 0;

    for (const [id, answer] of Object.entries(answers)) {
      if (validIds.has(id) && typeof answer === "string" && answer.trim()) {
        const trimmed = answer.trim();
        if (placeholderAnswers.has(trimmed.toLowerCase())) continue;
        validAnswers[id] = trimmed;
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
