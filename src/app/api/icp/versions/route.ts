import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const whereClause = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };

    const versions = await prisma.icpVersion.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            createdAt: true,
          },
        },
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    const formattedVersions = versions.map((v: typeof versions[number]) => {
      let content;
      let segmentCount = 0;

      try {
        content = JSON.parse(v.content);
        if (content.segments) {
          segmentCount = content.segments.length;
        }
      } catch {
        content = { segments: [] };
      }

      return {
        id: v.id,
        title: v.title,
        segmentCount,
        salesNarrativeVersionId: v.salesNarrativeVersionId,
        salesNarrativeCreatedAt: v.salesNarrativeVersion?.createdAt ?? null,
        createdAt: v.createdAt,
        userId: v.userId,
        user: v.user,
      };
    });

    return NextResponse.json({
      versions: formattedVersions,
      currentUserId: user.id,
    });
  } catch (error) {
    console.error("Error fetching ICP versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
