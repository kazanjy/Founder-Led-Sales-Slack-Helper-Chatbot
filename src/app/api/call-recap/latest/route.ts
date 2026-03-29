import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.callRecapVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestVersion) {
      return NextResponse.json({
        hasRecap: false,
        version: null,
      });
    }

    return NextResponse.json({
      hasRecap: true,
      version: {
        id: latestVersion.id,
        userId: latestVersion.userId,
        recordingUrl: latestVersion.recordingUrl,
        callSummary: latestVersion.callSummary,
        callTranscript: latestVersion.callTranscript,
        customNotes: latestVersion.customNotes,
        title: latestVersion.title,
        callType: latestVersion.callType,
        emailSubject: latestVersion.emailSubject,
        emailBody: latestVersion.emailBody,
        iterationHistory: latestVersion.iterationHistory,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest call recap:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest call recap" },
      { status: 500 }
    );
  }
}
