import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get counts in parallel
    const [
      totalUsers,
      trialUsers,
      activeUsers,
      totalWorkspaces,
      totalConversations,
      totalMessages,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { licenseStatus: "TRIAL" } }),
      prisma.user.count({ where: { licenseStatus: "ACTIVE" } }),
      prisma.workspace.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    // Get users with Google vs Slack
    const [googleUsers, slackUsers] = await Promise.all([
      prisma.user.count({ where: { googleId: { not: null } } }),
      prisma.user.count({ where: { slackUserId: { not: null } } }),
    ]);

    return NextResponse.json({
      stats: {
        totalUsers,
        trialUsers,
        activeUsers,
        expiredUsers: totalUsers - trialUsers - activeUsers,
        totalWorkspaces,
        totalConversations,
        totalMessages,
        recentUsers,
        googleUsers,
        slackUsers,
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
