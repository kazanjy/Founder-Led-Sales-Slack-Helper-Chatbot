import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get all cold call script versions (history)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const versions = await prisma.coldCallScriptVersion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orgPersona: true,
        humanPersona: true,
        specialNotes: true,
        scriptType: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ versions });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("does not exist") || errMsg.includes("P2021") || errMsg.includes("P2010")) {
      return NextResponse.json({ versions: [] });
    }
    console.error("Error fetching cold call script history:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
