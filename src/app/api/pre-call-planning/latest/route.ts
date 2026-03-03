import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest pre-call planning version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.preCallPlanningVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        firstCallChecklistVersion: {
          select: {
            id: true,
            createdAt: true,
            discoveryQuestionsVersion: {
              select: {
                id: true,
                createdAt: true,
                salesNarrativeVersion: {
                  select: {
                    id: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!latestVersion) {
      // Check if user has a first call checklist to generate from
      const hasFirstCallChecklist = await prisma.firstCallChecklistVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        hasPreCallPlanning: false,
        version: null,
        hasFirstCallChecklist: !!hasFirstCallChecklist,
      });
    }

    return NextResponse.json({
      hasPreCallPlanning: true,
      version: {
        id: latestVersion.id,
        content: latestVersion.content,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        firstCallChecklistVersion: latestVersion.firstCallChecklistVersion,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest pre-call planning:", error);
    return NextResponse.json(
      { error: "Failed to fetch pre-call planning" },
      { status: 500 }
    );
  }
}
