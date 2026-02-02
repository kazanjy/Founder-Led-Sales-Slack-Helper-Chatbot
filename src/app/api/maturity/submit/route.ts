import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Submit the completed assessment and create AI recommendations conversation
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all questions with user's latest answers
    const questions = await prisma.maturityQuestion.findMany({
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "maturity_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, string>(
      latestAnswers.map((a: { questionId: string; answer: string }) => [a.questionId, a.answer])
    );

    // Check if at least some questions are answered
    const answeredCount = latestAnswers.length;
    if (answeredCount === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions before submitting." },
        { status: 400 }
      );
    }

    // Define question type for clarity
    type QuestionType = typeof questions[0];

    // Build the assessment summary for the AI
    // Truncate individual answers to prevent exceeding API limits
    const MAX_ANSWER_LENGTH = 500; // Characters per answer
    const truncateAnswer = (answer: string) => {
      if (answer.length <= MAX_ANSWER_LENGTH) return answer;
      return answer.substring(0, MAX_ANSWER_LENGTH) + "... [truncated]";
    };

    const categories = Array.from(new Set(questions.map((q: QuestionType) => q.category))) as string[];
    let assessmentSummary = "# GTM Maturity Assessment Results\n\n";

    for (const category of categories) {
      assessmentSummary += `## ${category}\n\n`;
      const categoryQuestions = questions.filter((q: QuestionType) => q.category === category);

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        assessmentSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          assessmentSummary += `${truncateAnswer(answer)}\n\n`;
        } else {
          assessmentSummary += `_Not answered_\n\n`;
        }
      }
    }

    // Log the total size for debugging
    console.log("Assessment summary length:", assessmentSummary.length, "characters");

    // If still too long, create a more condensed version
    const MAX_TOTAL_LENGTH = 12000; // Conservative limit for API
    let finalSummary = assessmentSummary;

    if (assessmentSummary.length > MAX_TOTAL_LENGTH) {
      console.log("Assessment too long, creating condensed version");
      // Create a more condensed format - just answered questions
      finalSummary = "# GTM Maturity Assessment Results (Condensed)\n\n";
      for (const category of categories) {
        const categoryQuestions = questions.filter((q: QuestionType) => q.category === category);
        const answeredInCategory = categoryQuestions.filter(q => answerMap.has(q.id));

        if (answeredInCategory.length > 0) {
          finalSummary += `## ${category}\n\n`;
          for (const q of answeredInCategory) {
            const answer = answerMap.get(q.id)!;
            // More aggressive truncation for condensed version
            const shortAnswer = answer.length > 200 ? answer.substring(0, 200) + "..." : answer;
            finalSummary += `**${q.question}**\n${shortAnswer}\n\n`;
          }
        }
      }
      console.log("Condensed summary length:", finalSummary.length, "characters");
    }

    const userMessageContent = `I've completed the GTM Maturity Assessment. Please analyze my responses and provide personalized recommendations for improving my go-to-market strategy. Here are my responses:\n\n${finalSummary}`;

    // Create a new conversation for the AI recommendations
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: "GTM Maturity Assessment - Recommendations",
        firstMessagePreview: "Based on your GTM maturity assessment...",
        messageCount: 1,
      },
    });

    // Create the initial user message with the assessment
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: userMessageContent,
      },
    });

    // Call Chatbase to get AI recommendations
    let aiResponse = "";
    let chatbaseConvId: string | undefined;

    try {
      const chatbaseResult = await sendToChatbase(userMessageContent, undefined, []);
      aiResponse = chatbaseResult.response;
      chatbaseConvId = chatbaseResult.conversationId;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      // Provide a fallback message if Chatbase fails
      aiResponse = "I apologize, but I'm having trouble processing your assessment right now. Please try sending a follow-up message or come back later. Your assessment answers have been saved.";
    }

    // Save the assistant response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
      },
    });

    // Update conversation with Chatbase ID and message count
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        chatbaseConversationId: chatbaseConvId,
        messageCount: 2,
        lastMessageAt: new Date(),
      },
    });

    // Create the maturity assessment record
    const assessment = await prisma.maturityAssessment.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
      },
    });

    return NextResponse.json({
      success: true,
      assessment: {
        id: assessment.id,
        completedAt: assessment.completedAt,
      },
      conversation: {
        id: conversation.id,
        title: conversation.title,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
        categories: categories.map((cat) => ({
          name: cat,
          totalQuestions: questions.filter((q: QuestionType) => q.category === cat).length,
          answeredCount: questions.filter(
            (q: QuestionType) => q.category === cat && answerMap.has(q.id)
          ).length,
        })),
      },
    });
  } catch (error) {
    console.error("Error submitting assessment:", error);
    return NextResponse.json(
      { error: "Failed to submit assessment" },
      { status: 500 }
    );
  }
}
