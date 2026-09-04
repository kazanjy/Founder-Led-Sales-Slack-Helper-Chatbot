import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseHiringRole } from "@/lib/hiring/role-types";

// GET - Get the latest hiring profile version
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Account-scoped like the narrative: a teammate who didn't
    // personally generate the profile still sees the account's.
    const scope = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };
    const roleType = parseHiringRole(new URL(request.url).searchParams.get("roleType"));
    const latestVersion = await prisma.hiringProfileVersion.findFirst({
      where: { ...scope, roleType },
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

    if (!latestVersion) {
      return NextResponse.json({
        currentUserId: user.id,
        hasProfile: false,
        version: null,
        answersByCategory: null,
      });
    }

    // Group answers by category
    const answersByCategory: Record<string, Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
    }>> = {};

    for (const answer of latestVersion.answers) {
      const category = answer.question.category;
      if (!answersByCategory[category]) {
        answersByCategory[category] = [];
      }
      answersByCategory[category].push({
        questionId: answer.question.id,
        globalOrder: answer.question.globalOrder,
        question: answer.question.question,
        answer: answer.answer,
      });
    }

    return NextResponse.json({
      currentUserId: user.id,
      hasProfile: true,
      version: {
        id: latestVersion.id,
        userId: latestVersion.userId,
        title: latestVersion.title,
        content: latestVersion.content,
        iterationHistory: latestVersion.iterationHistory,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
        user: latestVersion.user,
      },
      answersByCategory,
    });
  } catch (error) {
    console.error("Error fetching latest hiring profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest hiring profile" },
      { status: 500 }
    );
  }
}
