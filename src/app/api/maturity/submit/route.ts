import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";
import { splitIntoChunks, buildChunkedHistory, CHATBASE_MESSAGE_LIMIT } from "@/lib/chatbase/chunking";
import { generateAssessmentTitle } from "@/lib/openai";

// POST - Submit the completed assessment and create AI recommendations conversation
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all enabled questions with user's latest answers
    const questions = await prisma.maturityQuestion.findMany({
      where: { enabled: true },
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
    const categories = Array.from(new Set(questions.map((q: QuestionType) => q.category))) as string[];
    let assessmentSummary = "# GTM Maturity Assessment Results\n\n";

    for (const category of categories) {
      assessmentSummary += `## ${category}\n\n`;
      const categoryQuestions = questions.filter((q: QuestionType) => q.category === category);

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        assessmentSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          assessmentSummary += `${answer}\n\n`;
        } else {
          assessmentSummary += `_Not answered_\n\n`;
        }
      }
    }

    // Log the total size for debugging
    console.log("Assessment summary length:", assessmentSummary.length, "characters");

    // Split the assessment into chunks for the conversation history (uses shared chunking utility)
    const assessmentChunks = splitIntoChunks(assessmentSummary, CHATBASE_MESSAGE_LIMIT);
    console.log(`Split assessment into ${assessmentChunks.length} chunks`);

    // Build the full user message for database storage
    const fullUserMessage = `I've completed the GTM Maturity Assessment. Please analyze my responses and provide personalized recommendations for improving my go-to-market strategy. Here are my responses:\n\n${assessmentSummary}`;

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

    // Create the initial user message with the full assessment (for database storage)
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: fullUserMessage,
      },
    });

    // Call Chatbase to get AI recommendations
    // Since Chatbase has an 8000 char limit, we send chunks as conversation history
    let aiResponse = "";
    let chatbaseConvId: string | undefined;

    try {
      // Build conversation history from assessment chunks using shared chunking utility
      const chatbaseHistory = buildChunkedHistory(assessmentChunks, "Assessment");

      // Send the final message asking for analysis
      const finalMessage = "Can you assess the maturity of the startup submitting this quiz, based on these questions and answers, and provide them which stage of Pete's GTM Maturity Model they're at, three things they're doing well, three things that they need to work on next, and three resources that they should refer to to help them, and the three chat prompts in Mikey they might consider doing next.";

      console.log(`Sending to Chatbase: ${chatbaseHistory.length} history messages, final message: ${finalMessage.length} chars`);

      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
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

    // Generate an AI title for the assessment based on the recommendations
    let assessmentTitle = "GTM Maturity Assessment";
    try {
      assessmentTitle = await generateAssessmentTitle(aiResponse);
    } catch (titleError) {
      console.error("Error generating assessment title:", titleError);
    }

    // Create the maturity assessment record
    const assessment = await prisma.maturityAssessment.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        title: assessmentTitle,
      },
    });

    // Create snapshot of all answers linked to this assessment
    // This captures the state of all answers at the time of submission
    const answerSnapshots = questions.map((q: QuestionType) => ({
      userId: user.id,
      questionId: q.id,
      assessmentId: assessment.id,
      answer: answerMap.get(q.id) || "",
    }));

    await prisma.maturityAnswer.createMany({
      data: answerSnapshots,
    });

    // Clear any update-in-progress state
    await prisma.user.update({
      where: { id: user.id },
      data: {
        maturityUpdateInProgress: false,
        maturityUpdateIndex: null,
        maturityUpdateStartedAt: null,
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
