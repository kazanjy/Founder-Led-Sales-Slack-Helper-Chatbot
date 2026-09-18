import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List bootstrap runs for current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const bootstraps = await prisma.objectionBootstrap.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orgPersona: true,
        humanPersona: true,
        entryCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ bootstraps });
  } catch (error) {
    console.error("Error fetching bootstrap history:", error);
    return NextResponse.json(
      { error: "Failed to fetch bootstrap history" },
      { status: 500 }
    );
  }
}
