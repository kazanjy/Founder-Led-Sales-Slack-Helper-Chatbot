import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all sales narrative versions visible to the current user (account-wide)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const whereClause = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };

    const versions = await prisma.salesNarrativeVersion.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        narrative: true,
        description1000w: true,
        description100w: true,
        description50w: true,
        description25w: true,
        createdAt: true,
        userId: true,
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    // Add preview (first 150 chars of narrative) for list display
    const versionsWithPreview = versions.map((v) => ({
      ...v,
      preview: v.narrative.substring(0, 150) + (v.narrative.length > 150 ? "..." : ""),
    }));

    return NextResponse.json({
      versions: versionsWithPreview,
      count: versions.length,
      currentUserId: user.id,
    });
  } catch (error) {
    console.error("Error fetching sales narrative versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
