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

    // Chatbase has an 8000 character limit per message
    // Split the assessment into chunks for the conversation history
    const CHATBASE_LIMIT = 7500; // Leave some buffer

    const splitIntoChunks = (text: string, maxLength: number): string[] => {
      const chunks: string[] = [];
      const sections = text.split(/(?=## )/); // Split by category headers

      let currentChunk = "";
      for (const section of sections) {
        if (currentChunk.length + section.length > maxLength) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          // If a single section is too long, split it further
          if (section.length > maxLength) {
            const lines = section.split("\n");
            currentChunk = "";
            for (const line of lines) {
              if (currentChunk.length + line.length + 1 > maxLength) {
                chunks.push(currentChunk.trim());
                currentChunk = line + "\n";
              } else {
                currentChunk += line + "\n";
              }
            }
          } else {
            currentChunk = section;
          }
        } else {
          currentChunk += section;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      return chunks;
    };

    const assessmentChunks = splitIntoChunks(assessmentSummary, CHATBASE_LIMIT);
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
      // Build conversation history from assessment chunks
      // Each chunk becomes a "user" message in history, then we send a final request
      const chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

      // Add chunks as context in conversation history
      for (let i = 0; i < assessmentChunks.length; i++) {
        const chunkLabel = assessmentChunks.length > 1
          ? `[Assessment Part ${i + 1} of ${assessmentChunks.length}]\n\n`
          : "";
        chatbaseHistory.push({
          role: "user",
          content: `${chunkLabel}${assessmentChunks[i]}`,
        });
        // Add acknowledgment from assistant to maintain conversation flow
        if (i < assessmentChunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1} of your GTM Maturity Assessment. Please continue with the remaining sections.`,
          });
        }
      }

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
