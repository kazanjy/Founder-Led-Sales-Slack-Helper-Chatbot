import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/chat/share/recent
 * Get recent email addresses the user has shared chats with (for typeahead)
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.toLowerCase().trim() || "";

    // Get unique recent share recipients
    const recentShares = await prisma.chatShare.findMany({
      where: {
        sharedByUserId: user.id,
        ...(query && {
          OR: [
            { sharedToEmail: { contains: query, mode: "insensitive" } },
            { sharedToUser: { name: { contains: query, mode: "insensitive" } } },
          ],
        }),
      },
      select: {
        sharedToEmail: true,
        createdAt: true,
        sharedToUser: {
          select: {
            name: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50, // Get more to dedupe
    });

    // Dedupe by email, keeping most recent
    const seen = new Set<string>();
    const recipients: Array<{
      email: string;
      name: string | null;
      avatarUrl: string | null;
      lastSharedAt: Date;
    }> = [];

    for (const share of recentShares) {
      if (!seen.has(share.sharedToEmail)) {
        seen.add(share.sharedToEmail);
        recipients.push({
          email: share.sharedToEmail,
          name: share.sharedToUser?.name || null,
          avatarUrl: share.sharedToUser?.avatarUrl || null,
          lastSharedAt: share.createdAt,
        });
      }
      if (recipients.length >= 10) break;
    }

    return NextResponse.json({ recipients });
  } catch (error) {
    console.error("Get recent recipients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
