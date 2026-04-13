import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — fetch user's prompt guidance
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    return NextResponse.json({ promptGuidance: user.promptGuidance || "" });
  } catch (error) {
    console.error("Error fetching prompt guidance:", error);
    return NextResponse.json({ error: "Failed to fetch prompt guidance" }, { status: 500 });
  }
}

// PUT — update user's prompt guidance
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { promptGuidance } = (await request.json()) as { promptGuidance: string };

    await prisma.user.update({
      where: { id: user.id },
      data: { promptGuidance: promptGuidance?.trim() || null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving prompt guidance:", error);
    return NextResponse.json({ error: "Failed to save prompt guidance" }, { status: 500 });
  }
}
