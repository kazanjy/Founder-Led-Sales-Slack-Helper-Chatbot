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
    const status = searchParams.get("status") || ""; // TRIAL, ACTIVE, EXPIRED
    const identityType = searchParams.get("identityType") || ""; // google, slack, both
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    const skip = (page - 1) * limit;

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // Search by email, name, or slack username
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { slackUserName: { contains: search, mode: "insensitive" } },
        { slackEmail: { contains: search, mode: "insensitive" } },
      ];
    }

    // Filter by license status
    if (status) {
      where.licenseStatus = status as "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
    }

    // Filter by identity type
    if (identityType === "google") {
      where.googleId = { not: null };
      where.slackUserId = null;
    } else if (identityType === "slack") {
      where.slackUserId = { not: null };
      where.googleId = null;
    } else if (identityType === "both") {
      where.googleId = { not: null };
      where.slackUserId = { not: null };
    }

    // Build orderBy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderBy: Record<string, any> = {};
    if (sortBy === "createdAt") {
      orderBy.createdAt = sortOrder as "asc" | "desc";
    } else if (sortBy === "name") {
      orderBy.name = sortOrder as "asc" | "desc";
    } else if (sortBy === "email") {
      orderBy.email = sortOrder as "asc" | "desc";
    }

    // Get users with pagination
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          workspace: {
            select: {
              id: true,
              slackTeamName: true,
            },
          },
          license: {
            select: {
              id: true,
              status: true,
              expiresAt: true,
              stripeSubscriptionId: true,
            },
          },
          _count: {
            select: {
              conversations: true,
              messages: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Transform for response
    const transformedUsers = users.map((user: typeof users[number]) => ({
      id: user.id,
      email: user.email || user.slackEmail,
      name: user.name || user.slackUserName,
      avatarUrl: user.avatarUrl,
      licenseStatus: user.licenseStatus,
      trialStartedAt: user.trialStartedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      // Identity flags
      hasGoogle: !!user.googleId,
      hasSlack: !!user.slackUserId,
      slackUserId: user.slackUserId,
      googleId: user.googleId,
      // Workspace
      workspace: user.workspace
        ? {
            id: user.workspace.id,
            name: user.workspace.slackTeamName,
          }
        : null,
      // License
      license: user.license
        ? {
            id: user.license.id,
            status: user.license.status,
            expiresAt: user.license.expiresAt,
            hasStripe: !!user.license.stripeSubscriptionId,
          }
        : null,
      // Stats
      conversationCount: user._count.conversations,
      messageCount: user._count.messages,
    }));

    return NextResponse.json({
      users: transformedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
