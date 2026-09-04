import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { splitIntoChunks, buildChunkedHistory, CHATBASE_MESSAGE_LIMIT } from "@/lib/chatbase/chunking";

// POST - Start a new chat with sales metrics assessment context
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { assessmentId, userPrompt } = body;

    // Get the assessment
    let assessment;
    if (assessmentId) {
      assessment = await prisma.salesMetricsAssessment.findFirst({
        where: { id: assessmentId, userId: user.id },
        include: {
          answers: {
            include: {
              question: {
                select: { globalOrder: true, question: true, category: true },
              },
            },
          },
        },
      });
    } else {
      // Get latest assessment
      assessment = await prisma.salesMetricsAssessment.findFirst({
        where: { userId: user.id },
        orderBy: { completedAt: "desc" },
        include: {
          answers: {
            include: {
              question: {
                select: { globalOrder: true, question: true, category: true },
              },
            },
          },
        },
      });
    }

    if (!assessment) {
      return NextResponse.json(
        { error: "No sales metrics assessment found. Please complete an analysis first." },
        { status: 400 }
      );
    }

    // Build context from assessment
    let context = "# Sales Metrics Assessment\n\n";
    context += `*Completed: ${assessment.completedAt.toLocaleDateString()}*\n\n`;

    // Add Q&A pairs
    const sortedAnswers = assessment.answers
      .filter((a) => a.answer && a.answer.trim())
      .sort((a, b) => a.question.globalOrder - b.question.globalOrder);

    const categories = Array.from(new Set(sortedAnswers.map((a) => a.question.category)));
    for (const category of categories) {
      context += `## ${category}\n\n`;
      const catAnswers = sortedAnswers.filter((a) => a.question.category === category);
      for (const a of catAnswers) {
        context += `**Q${a.question.globalOrder}: ${a.question.question}**\n${a.answer}\n\n`;
      }
    }

    // Add analysis report if available
    if (assessment.analysisReport) {
      context += "\n---\n\n" + assessment.analysisReport;
    }

    // Add CSV data summary if available (truncated for chat context)
    if (assessment.csvData) {
      const csvPreview = assessment.csvData.substring(0, 10000);
      context += "\n---\n\n## Raw Opportunity Data (CSV Preview)\n\n" + csvPreview;
    }

    // Create the user message
    const userQuestion = userPrompt || "I'd like to discuss my sales metrics analysis. What should I focus on improving first?";
    const userMessage = `${userQuestion}\n\nHere is my sales metrics data for context:\n\n${context}`;

    // Create conversation
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: "Chat with Sales Metrics",
        firstMessagePreview: userPrompt ? userPrompt.substring(0, 100) : "Discussing sales metrics analysis...",
        messageCount: 1,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: userMessage,
      },
    });

    // Call Chatbase
    let aiResponse = "";
    let chatbaseConvId: string | undefined;

    try {
      const contextChunks = splitIntoChunks(context, CHATBASE_MESSAGE_LIMIT);
      const chatbaseHistory = buildChunkedHistory(contextChunks, "Sales Metrics");

      const promptMessage = userPrompt || "I've shared my sales metrics analysis with you. What should I focus on improving first?";

      const chatbaseResult = await sendToChatbase(promptMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
      chatbaseConvId = chatbaseResult.conversationId;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      aiResponse = "I've reviewed your sales metrics. I'm ready to discuss your performance and help you identify opportunities for improvement. What specific metrics or areas would you like to explore?";
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        chatbaseConversationId: chatbaseConvId,
        messageCount: 2,
        lastMessageAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
    });
  } catch (error) {
    console.error("Error starting sales metrics chat:", error);
    return NextResponse.json(
      { error: "Failed to start chat" },
      { status: 500 }
    );
  }
}
