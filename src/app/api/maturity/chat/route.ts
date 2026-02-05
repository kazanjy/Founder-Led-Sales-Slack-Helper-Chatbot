import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Start a new chat with assessment answers as context
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { assessmentId } = body;

    // Get all questions
    const questions = await prisma.maturityQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    type QuestionType = typeof questions[0];

    let answerMap: Map<string, string>;
    let assessmentDate: Date | null = null;

    if (assessmentId) {
      // Get answers from specific assessment
      const assessment = await prisma.maturityAssessment.findFirst({
        where: { id: assessmentId, userId: user.id },
        include: {
          answers: true,
        },
      });

      if (!assessment) {
        return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
      }

      assessmentDate = assessment.completedAt;

      // If assessment has linked answers, use those
      if (assessment.answers.length > 0) {
        answerMap = new Map(
          assessment.answers.map((a) => [a.questionId, a.answer])
        );
      } else {
        // Fall back to user's latest answers (for old assessments)
        const latestAnswers = await prisma.$queryRaw<
          Array<{ questionId: string; answer: string }>
        >`
          SELECT DISTINCT ON ("questionId") "questionId", "answer"
          FROM "maturity_answers"
          WHERE "userId" = ${user.id}
          ORDER BY "questionId", "createdAt" DESC
        `;
        answerMap = new Map(latestAnswers.map((a) => [a.questionId, a.answer]));
      }
    } else {
      // Get user's current/latest answers
      const latestAnswers = await prisma.$queryRaw<
        Array<{ questionId: string; answer: string }>
      >`
        SELECT DISTINCT ON ("questionId") "questionId", "answer"
        FROM "maturity_answers"
        WHERE "userId" = ${user.id}
        ORDER BY "questionId", "createdAt" DESC
      `;
      answerMap = new Map(latestAnswers.map((a) => [a.questionId, a.answer]));
    }

    // Check if we have any answers
    if (answerMap.size === 0) {
      return NextResponse.json(
        { error: "No assessment answers found. Please complete an assessment first." },
        { status: 400 }
      );
    }

    // Build the assessment context
    const categories = Array.from(new Set(questions.map((q: QuestionType) => q.category))) as string[];
    let assessmentContext = "# GTM Maturity Assessment Answers\n\n";

    if (assessmentDate) {
      assessmentContext += `*Assessment completed: ${assessmentDate.toLocaleDateString()}*\n\n`;
    }

    for (const category of categories) {
      assessmentContext += `## ${category}\n\n`;
      const categoryQuestions = questions.filter((q: QuestionType) => q.category === category);

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        assessmentContext += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          assessmentContext += `${answer}\n\n`;
        } else {
          assessmentContext += `_Not answered_\n\n`;
        }
      }
    }

    // Create the user message
    const userMessage = `I'd like to have a conversation using my GTM Maturity Assessment answers as context. Here are my answers:\n\n${assessmentContext}`;

    // Create a new conversation
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: "Chat with GTM Assessment",
        firstMessagePreview: "Using my GTM assessment answers as context...",
        messageCount: 1,
      },
    });

    // Create the initial user message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: userMessage,
      },
    });

    // Call Chatbase to get initial response
    let aiResponse = "";
    let chatbaseConvId: string | undefined;

    try {
      // Split context into chunks if needed (Chatbase has 8000 char limit)
      const CHATBASE_LIMIT = 7500;
      const chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

      if (assessmentContext.length > CHATBASE_LIMIT) {
        // Split into chunks
        const chunks: string[] = [];
        let currentChunk = "";
        const sections = assessmentContext.split(/(?=## )/);

        for (const section of sections) {
          if (currentChunk.length + section.length > CHATBASE_LIMIT) {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = section;
          } else {
            currentChunk += section;
          }
        }
        if (currentChunk.trim()) chunks.push(currentChunk.trim());

        // Add chunks as conversation history
        for (let i = 0; i < chunks.length; i++) {
          chatbaseHistory.push({
            role: "user",
            content: `[Assessment Context Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
          });
          if (i < chunks.length - 1) {
            chatbaseHistory.push({
              role: "assistant",
              content: `I've received part ${i + 1} of your GTM assessment context. Please continue.`,
            });
          }
        }
      } else {
        chatbaseHistory.push({
          role: "user",
          content: `Here are my GTM Maturity Assessment answers for context:\n\n${assessmentContext}`,
        });
      }

      // Send the prompt to start the conversation
      const promptMessage = "Great, I've shared my GTM assessment answers with you. I'd like to have a conversation about my go-to-market strategy using these as context. What questions do you have, or what would you like to discuss?";

      const chatbaseResult = await sendToChatbase(promptMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
      chatbaseConvId = chatbaseResult.conversationId;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      aiResponse = "I've reviewed your GTM Maturity Assessment answers. I'm ready to discuss your go-to-market strategy! What specific aspects would you like to explore? For example:\n\n- Dive deeper into any of your answers\n- Get advice on areas you're struggling with\n- Discuss next steps for improving your GTM maturity\n- Explore specific topics like ICP, pricing, or sales process\n\nWhat would you like to focus on?";
    }

    // Save the assistant response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
      },
    });

    // Update conversation
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
    console.error("Error starting assessment chat:", error);
    return NextResponse.json(
      { error: "Failed to start chat" },
      { status: 500 }
    );
  }
}
