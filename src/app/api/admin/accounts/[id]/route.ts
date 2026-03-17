import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            slackUserName: true,
            slackUserId: true,
            accountRole: true,
            workspaceId: true,
            workspace: {
              select: { id: true, slackTeamName: true },
            },
          },
          orderBy: { accountRole: "asc" },
        },
        channelClaims: {
          include: {
            claimedBy: {
              select: { id: true, name: true, email: true, slackUserName: true },
            },
            workspace: {
              select: { id: true, slackTeamName: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    console.error("Admin account detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
