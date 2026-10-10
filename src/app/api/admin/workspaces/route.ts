import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";

    const skip = (page - 1) * limit;

    // Build where clause
    const where = search
      ? {
          slackTeamName: { contains: search, mode: "insensitive" as const },
        }
      : {};

    const [workspaces, total] = await Promise.all([
      prisma.workspace.findMany({
        where,
        orderBy: { installedAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              users: true,
              conversations: true,
            },
          },
        },
      }),
      prisma.workspace.count({ where }),
    ]);

    const transformedWorkspaces = workspaces.map((ws: typeof workspaces[number]) => ({
      id: ws.id,
      slackTeamId: ws.slackTeamId,
      slackTeamName: ws.slackTeamName,
      installedAt: ws.installedAt,
      botUserId: ws.botUserId,
      trialDays: ws.trialDays,
      trialMessages: ws.trialMessages,
      dailyMessageLimit: ws.dailyMessageLimit,
      userCount: ws._count.users,
      conversationCount: ws._count.conversations,
      createdAt: ws.createdAt,
    }));

    return NextResponse.json({
      workspaces: transformedWorkspaces,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin workspaces error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
