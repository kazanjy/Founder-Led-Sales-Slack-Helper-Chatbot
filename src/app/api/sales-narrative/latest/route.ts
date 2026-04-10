import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest sales narrative version (for merge variables display)
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const checkAccount = searchParams.get("account") === "true";

    // If checking account-level, look for any narrative from account teammates
    if (checkAccount && user.accountId) {
      const accountNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: {
          user: { accountId: user.accountId },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return NextResponse.json({ hasNarrative: !!accountNarrative });
    }

    // Try user's own, then fall back to account teammate's
    let latestVersion = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        answers: {
          include: {
            question: {
              select: {
                id: true,
                category: true,
                globalOrder: true,
                question: true,
              },
            },
          },
          orderBy: {
            question: {
              globalOrder: "asc",
            },
          },
        },
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    // Fall back to account teammate's latest version
    if (!latestVersion && user.accountId) {
      latestVersion = await prisma.salesNarrativeVersion.findFirst({
        where: { user: { accountId: user.accountId } },
        orderBy: { createdAt: "desc" },
        include: {
          answers: {
            include: {
              question: {
                select: { id: true, category: true, globalOrder: true, question: true },
              },
            },
            orderBy: { question: { globalOrder: "asc" } },
          },
          user: { select: { id: true, name: true, email: true, slackUserName: true } },
        },
      });
    }

    if (!latestVersion) {
      return NextResponse.json({
        currentUserId: user.id,
        hasNarrative: false,
        version: null,
        answersByCategory: null,
      });
    }

    // Group answers by category
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    const answersByCategory: Record<string, Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
    }>> = {};

    for (const category of categoryOrder) {
      answersByCategory[category] = [];
    }

    for (const answer of latestVersion.answers) {
      const category = answer.question.category;
      if (answersByCategory[category]) {
        answersByCategory[category].push({
          questionId: answer.question.id,
          globalOrder: answer.question.globalOrder,
          question: answer.question.question,
          answer: answer.answer,
        });
      }
    }

    return NextResponse.json({
      currentUserId: user.id,
      hasNarrative: true,
      version: {
        id: latestVersion.id,
        userId: latestVersion.userId,
        title: latestVersion.title,
        narrative: latestVersion.narrative,
        description1000w: latestVersion.description1000w,
        description100w: latestVersion.description100w,
        description50w: latestVersion.description50w,
        description25w: latestVersion.description25w,
        sourceUrls: latestVersion.sourceUrls,
        sourcePdfNames: latestVersion.sourcePdfNames,
        createdAt: latestVersion.createdAt,
        user: latestVersion.user,
      },
      answersByCategory,
    });
  } catch (error) {
    console.error("Error fetching latest sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest narrative" },
      { status: 500 }
    );
  }
}
