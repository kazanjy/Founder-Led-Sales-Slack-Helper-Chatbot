import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const versions = await prisma.callRecapVersion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        callType: true,
        emailSubject: true,
        createdAt: true,
        updatedAt: true,
        iterationHistory: true,
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error fetching call recap history:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
