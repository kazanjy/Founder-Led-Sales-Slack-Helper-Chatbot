import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all sales narrative versions for the current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const versions = await prisma.salesNarrativeVersion.findMany({
      where: { userId: user.id },
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
    });
  } catch (error) {
    console.error("Error fetching sales narrative versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
