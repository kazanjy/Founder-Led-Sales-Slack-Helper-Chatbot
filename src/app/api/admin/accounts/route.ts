import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { emailDomain: { contains: search, mode: "insensitive" } },
      ];
    }

    const accounts = await prisma.account.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            channelClaims: true,
          },
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
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            slackUserName: true,
            accountRole: true,
            workspace: {
              select: { id: true, slackTeamName: true },
            },
          },
          orderBy: { accountRole: "asc" },
        },
      },
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("Admin accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
