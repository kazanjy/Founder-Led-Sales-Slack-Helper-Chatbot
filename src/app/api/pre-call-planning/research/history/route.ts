import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get all research briefs for the user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const researches = await prisma.preCallResearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        contactTitle: true,
        source: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ researches });
  } catch (error) {
    console.error("Error fetching research history:", error);
    return NextResponse.json(
      { error: "Failed to fetch research history" },
      { status: 500 }
    );
  }
}
