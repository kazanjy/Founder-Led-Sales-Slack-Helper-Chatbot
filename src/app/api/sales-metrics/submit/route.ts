import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { getAnalysisPrompt } from "@/lib/sales-metrics/prompts";
import { sendToChatbase } from "@/lib/chatbase/client";
import { splitIntoChunks, buildChunkedHistory, CHATBASE_MESSAGE_LIMIT } from "@/lib/chatbase/chunking";

// Allow up to 120s for AI analysis
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { csvData, csvFileName, csvInsights } = body;

    // Get all enabled questions
    const questions = await prisma.salesMetricsQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; source: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "source", "createdAt"
      FROM "sales_metrics_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, { answer: string; source: string }>(
      latestAnswers.map((a) => [a.questionId, { answer: a.answer, source: a.source }])
    );

    // Check if at least some questions are answered
    if (latestAnswers.length === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions or upload a CSV before submitting." },
        { status: 400 }
      );
    }

    // Build questions & answers text for GPT
    const categories = Array.from(new Set(questions.map((q) => q.category))) as string[];
    let questionsAndAnswers = "";

    for (const category of categories) {
      questionsAndAnswers += `## ${category}\n\n`;
      const categoryQuestions = questions.filter((q) => q.category === category);

      for (const q of categoryQuestions) {
        const entry = answerMap.get(q.id);
        questionsAndAnswers += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (entry) {
          questionsAndAnswers += `${entry.answer} (source: ${entry.source})\n\n`;
        } else {
          questionsAndAnswers += `_Not answered_\n\n`;
        }
      }
    }

    // Truncate CSV data if provided
    const truncatedCsv = csvData ? csvData.substring(0, 50000) : undefined;
    const csvInsightsStr = csvInsights ? JSON.stringify(csvInsights) : undefined;

    // Call GPT 5.2 for analysis
    const prompt = getAnalysisPrompt(questionsAndAnswers, truncatedCsv, csvInsightsStr);

    console.log("[Sales Metrics] Calling GPT for analysis, prompt length:", prompt.length);

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const aiContent = response.choices[0]?.message?.content;
    if (!aiContent) {
      throw new Error("No response from AI");
    }

    const analysisResult = JSON.parse(aiContent);

    // Build a readable analysis report markdown from the structured result
    let analysisReport = "# Sales Metrics Analysis\n\n";

    // Top 3 Strengths
    analysisReport += "## Top 3 Strengths\n\n";
    for (const s of analysisResult.top3Strengths || []) {
      analysisReport += `### ✅ ${s.title}\n${s.detail}\n\n`;
    }

    // Top 3 Improvements
    analysisReport += "## Top 3 Areas for Improvement\n\n";
    for (const s of analysisResult.top3Improvements || []) {
      analysisReport += `### ⚠️ ${s.title}\n${s.detail}\n\n`;
    }

    // Work on next
    if (analysisResult.workOnNext) {
      analysisReport += "## #1 Priority: What to Work on Next\n\n";
      analysisReport += `### 🎯 ${analysisResult.workOnNext.title}\n`;
      analysisReport += `${analysisResult.workOnNext.detail}\n\n`;
      if (analysisResult.workOnNext.actionSteps?.length) {
        analysisReport += "**Action Steps:**\n";
        for (const step of analysisResult.workOnNext.actionSteps) {
          analysisReport += `- ${step}\n`;
        }
        analysisReport += "\n";
      }
    }

    // General analysis
    if (analysisResult.generalAnalysis) {
      analysisReport += "## General Analysis\n\n";
      analysisReport += analysisResult.generalAnalysis + "\n\n";
    }

    // CSV Deep Dive
    if (analysisResult.csvDeepDive) {
      analysisReport += "## CSV Data Deep Dive\n\n";
      const dd = analysisResult.csvDeepDive;
      if (dd.winRateBySource) {
        analysisReport += "### Win Rate by Lead Source\n" + dd.winRateBySource + "\n\n";
      }
      if (dd.trends) {
        analysisReport += "### Trends Over Time\n" + dd.trends + "\n\n";
      }
      if (dd.repPerformance) {
        analysisReport += "### Rep Performance\n" + dd.repPerformance + "\n\n";
      }
      if (dd.pipelineHealth) {
        analysisReport += "### Pipeline Health\n" + dd.pipelineHealth + "\n\n";
      }
      if (dd.otherInsights) {
        analysisReport += "### Other Insights\n" + dd.otherInsights + "\n\n";
      }
    }

    // Create a conversation for follow-up chat
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: "Sales Metrics Analysis",
        firstMessagePreview: "Sales metrics analysis and recommendations...",
        messageCount: 1,
      },
    });

    // Create the initial user message
    const fullUserMessage = `I've submitted my sales metrics for analysis. Here are my responses:\n\n${questionsAndAnswers}${csvData ? "\n\nI also uploaded CRM opportunity data for deeper analysis." : ""}`;

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: fullUserMessage,
      },
    });

    // Send to Chatbase for the initial response with context
    let chatbaseConvId: string | undefined;
    try {
      const contextChunks = splitIntoChunks(analysisReport, CHATBASE_MESSAGE_LIMIT);
      const chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Metrics Analysis");

      const chatbaseResult = await sendToChatbase(
        "I've just received my sales metrics analysis. I'd like to discuss the findings and get more specific recommendations. What should I focus on first?",
        undefined,
        chatbaseHistory
      );

      // Save assistant response
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: chatbaseResult.response,
        },
      });

      chatbaseConvId = chatbaseResult.conversationId;
    } catch (chatbaseError) {
      console.error("Chatbase error:", chatbaseError);
      // Save fallback response
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: "I've reviewed your sales metrics analysis. What aspects would you like to explore further? I can help you dive deeper into any of the findings, discuss benchmarks, or create action plans for improvement areas.",
        },
      });
    }

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        chatbaseConversationId: chatbaseConvId,
        messageCount: 2,
        lastMessageAt: new Date(),
      },
    });

    // Generate assessment title
    let assessmentTitle = "Sales Metrics Analysis";
    try {
      const titleResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a sales metrics summarizer. Given an analysis of sales metrics, create a one-sentence title (under 80 characters) that summarizes the key finding. Do not use quotes.",
          },
          {
            role: "user",
            content: `Generate a one-sentence summary title (under 80 chars) for this sales metrics analysis:\n\n${analysisReport.substring(0, 2000)}`,
          },
        ],
        max_completion_tokens: 100,
        temperature: 0.7,
      });
      const titleText = titleResponse.choices[0]?.message?.content?.trim();
      if (titleText && titleText.length <= 80) {
        assessmentTitle = titleText;
      } else if (titleText) {
        assessmentTitle = titleText.substring(0, 77) + "...";
      }
    } catch (titleError) {
      console.error("Error generating assessment title:", titleError);
    }

    // Create the assessment record
    const assessment = await prisma.salesMetricsAssessment.create({
      data: {
        userId: user.id,
        title: assessmentTitle,
        conversationId: conversation.id,
        csvData: csvData || null,
        csvFileName: csvFileName || null,
        calculatedMetrics: JSON.stringify(analysisResult.metricsTable || {}),
        analysisReport,
      },
    });

    // Snapshot all answers
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      assessmentId: assessment.id,
      answer: answerMap.get(q.id)?.answer || "",
      source: answerMap.get(q.id)?.source || "manual",
    }));

    await prisma.salesMetricsAnswer.createMany({
      data: answerSnapshots,
    });

    return NextResponse.json({
      success: true,
      assessment: {
        id: assessment.id,
        title: assessmentTitle,
        completedAt: assessment.completedAt,
      },
      conversation: {
        id: conversation.id,
      },
      analysis: analysisResult,
      analysisReport,
    });
  } catch (error) {
    console.error("Error submitting sales metrics:", error);
    return NextResponse.json(
      { error: "Failed to analyze sales metrics. Please try again." },
      { status: 500 }
    );
  }
}
