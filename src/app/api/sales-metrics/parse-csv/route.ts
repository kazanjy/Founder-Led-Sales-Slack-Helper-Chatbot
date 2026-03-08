import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { getCSVParsePrompt } from "@/lib/sales-metrics/prompts";
import Papa from "papaparse";

// Allow up to 120s for AI analysis of CSV
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isCSV = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
    if (!isCSV) {
      return NextResponse.json(
        { error: "Please upload a CSV file (.csv)" },
        { status: 400 }
      );
    }

    // Parse CSV
    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json(
        { error: "Could not parse the CSV file. Please check the format and try again." },
        { status: 400 }
      );
    }

    if (parsed.data.length === 0) {
      return NextResponse.json(
        { error: "CSV file appears to be empty. Please upload a file with opportunity data." },
        { status: 400 }
      );
    }

    console.log(`[Sales Metrics] Parsed CSV: ${parsed.data.length} rows, ${parsed.meta.fields?.length || 0} columns`);
    console.log(`[Sales Metrics] Columns: ${parsed.meta.fields?.join(", ")}`);

    // Convert rows to readable text for GPT
    const csvReadableText = parsed.data
      .map((row) =>
        Object.entries(row)
          .filter(([, val]) => val && val.trim())
          .map(([key, val]) => `${key}: ${val}`)
          .join(" | ")
      )
      .filter((block) => block.trim())
      .join("\n");

    // Truncate to avoid token limits (keep first 50k chars)
    const truncatedCsv = csvReadableText.substring(0, 50000);

    // Get all questions to build the questions list
    const questions = await prisma.salesMetricsQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    const questionsList = questions
      .map((q) => `${q.globalOrder}. ${q.question} (${q.helpText || ""})`)
      .join("\n");

    // Call GPT 5.2 to parse metrics from CSV
    const prompt = getCSVParsePrompt(truncatedCsv, questionsList);

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const aiContent = response.choices[0]?.message?.content;
    if (!aiContent) {
      throw new Error("No response from AI");
    }

    const result = JSON.parse(aiContent);

    // Save pre-filled answers to the database
    const prefillAnswers = result.prefillAnswers || {};
    let prefilledCount = 0;

    for (const q of questions) {
      const prefill = prefillAnswers[String(q.globalOrder)];
      if (prefill && prefill.value && prefill.value !== "null" && prefill.value !== null) {
        await prisma.salesMetricsAnswer.create({
          data: {
            userId: user.id,
            questionId: q.id,
            answer: String(prefill.value),
            source: "csv",
          },
        });
        prefilledCount++;
      }
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      rowCount: parsed.data.length,
      columnCount: parsed.meta.fields?.length || 0,
      columns: parsed.meta.fields || [],
      prefilledCount,
      totalQuestions: questions.length,
      prefillAnswers: result.prefillAnswers,
      additionalInsights: result.additionalInsights,
      columnMapping: result.columnMapping,
      // Return the raw CSV text for later submission
      csvData: csvText,
    });
  } catch (error) {
    console.error("Error parsing CSV for sales metrics:", error);
    return NextResponse.json(
      { error: "Failed to analyze the CSV file. Please check the format and try again." },
      { status: 500 }
    );
  }
}
