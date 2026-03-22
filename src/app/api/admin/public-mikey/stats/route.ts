import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/public-mikey/stats — Aggregated stats for admin overview
 */
export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      total,
      published,
      hidden,
      draft,
      twitterCount,
      askMikeyCount,
      viewsAgg,
      last7Days,
      last30Days,
    ] = await Promise.all([
      prisma.publicAnswer.count(),
      prisma.publicAnswer.count({ where: { status: "published" } }),
      prisma.publicAnswer.count({ where: { status: "hidden" } }),
      prisma.publicAnswer.count({ where: { status: "draft" } }),
      prisma.publicAnswer.count({ where: { source: "twitter" } }),
      prisma.publicAnswer.count({ where: { source: "ask-mikey" } }),
      prisma.publicAnswer.aggregate({ _sum: { viewCount: true }, _avg: { viewCount: true } }),
      prisma.publicAnswer.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.publicAnswer.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    return NextResponse.json({
      stats: {
        total,
        published,
        hidden,
        draft,
        twitterCount,
        askMikeyCount,
        totalViews: viewsAgg._sum.viewCount || 0,
        avgViews: Math.round(viewsAgg._avg.viewCount || 0),
        last7Days,
        last30Days,
      },
    });
  } catch (error) {
    console.error("Admin public-mikey stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
