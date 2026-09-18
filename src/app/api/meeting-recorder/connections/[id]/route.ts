import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// DELETE — disconnect a provider
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const connection = await prisma.meetingRecorderConnection.findFirst({
      where: { id, userId: user.id },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await prisma.meetingRecorderConnection.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error disconnecting:", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
