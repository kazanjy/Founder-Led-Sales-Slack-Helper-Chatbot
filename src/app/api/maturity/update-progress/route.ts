import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST: Start or update progress in update mode
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { action, currentIndex } = body;

    if (action === "start") {
      // Start a new update session
      await prisma.user.update({
        where: { id: user.id },
        data: {
          maturityUpdateInProgress: true,
          maturityUpdateIndex: 0,
          maturityUpdateStartedAt: new Date(),
        },
      });

      return NextResponse.json({ success: true, message: "Update session started" });
    }

    if (action === "progress") {
      // Update current position in the update flow
      if (typeof currentIndex !== "number") {
        return NextResponse.json({ error: "currentIndex required" }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          maturityUpdateIndex: currentIndex,
        },
      });

      return NextResponse.json({ success: true, currentIndex });
    }

    if (action === "cancel") {
      // Cancel the update session (user abandoned)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          maturityUpdateInProgress: false,
          maturityUpdateIndex: null,
          maturityUpdateStartedAt: null,
        },
      });

      return NextResponse.json({ success: true, message: "Update session cancelled" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error managing update progress:", error);
    return NextResponse.json(
      { error: "Failed to manage update progress" },
      { status: 500 }
    );
  }
}

// GET: Get current update progress
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    return NextResponse.json({
      inProgress: user.maturityUpdateInProgress,
      currentIndex: user.maturityUpdateIndex,
      startedAt: user.maturityUpdateStartedAt,
    });
  } catch (error) {
    console.error("Error fetching update progress:", error);
    return NextResponse.json(
      { error: "Failed to fetch update progress" },
      { status: 500 }
    );
  }
}
