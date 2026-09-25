import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const [salesDeck, emailSequence, linkedinSequence, socialContent, coldCallScript] =
      await Promise.all([
        prisma.salesDeckVersion.findFirst({ where: { userId: user.id }, select: { id: true } }),
        prisma.emailSequenceVersion.findFirst({ where: { userId: user.id }, select: { id: true } }),
        prisma.linkedInSequenceVersion.findFirst({ where: { userId: user.id }, select: { id: true } }),
        prisma.socialContentVersion.findFirst({ where: { userId: user.id }, select: { id: true } }),
        prisma.coldCallScriptVersion.findFirst({ where: { userId: user.id }, select: { id: true } }),
      ]);

    return NextResponse.json({
      salesDeck: !!salesDeck,
      emailSequence: !!emailSequence,
      linkedinSequence: !!linkedinSequence,
      socialContent: !!socialContent,
      coldCallScript: !!coldCallScript,
    });
  } catch (error) {
    console.error("Error checking content status:", error);
    return NextResponse.json({ error: "Failed to check content status" }, { status: 500 });
  }
}
