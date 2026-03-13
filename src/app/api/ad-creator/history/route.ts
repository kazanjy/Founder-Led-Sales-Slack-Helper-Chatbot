import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get all ad creator versions (history)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const versions = await prisma.adCreatorVersion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orgPersona: true,
        humanPersona: true,
        specialNotes: true,
        platforms: true,
        iteratedFromId: true,
        iterationNotes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error fetching ad creator history:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
