import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get all pre-call planning versions for the user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const whereClause = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };

    const versions = await prisma.preCallPlanningVersion.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
        firstCallChecklistVersion: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({ versions, currentUserId: user.id });
  } catch (error) {
    console.error("Error fetching pre-call planning versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
