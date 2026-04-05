import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/chat/share/recent
 * Get recent email addresses the user has shared chats with (for typeahead)
 * Also includes account teammates as suggestions
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.toLowerCase().trim() || "";

    // Get account teammates (if user has an account)
    let teammates: Array<{
      email: string;
      name: string | null;
      avatarUrl: string | null;
      isTeammate: boolean;
    }> = [];

    if (user.accountId) {
      const accountUsers = await prisma.user.findMany({
        where: {
          accountId: user.accountId,
          id: { not: user.id }, // Exclude self
          ...(query && {
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { slackUserName: { contains: query, mode: "insensitive" } },
            ],
          }),
        },
        select: {
          email: true,
          name: true,
          slackUserName: true,
          avatarUrl: true,
        },
        take: 10,
      });

      teammates = accountUsers.map((u) => ({
        email: u.email,
        name: u.name || u.slackUserName || null,
        avatarUrl: u.avatarUrl || null,
        isTeammate: true,
      }));
    }

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
    const recentRecipients: Array<{
      email: string;
      name: string | null;
      avatarUrl: string | null;
      lastSharedAt: Date;
    }> = [];

    for (const share of recentShares) {
      if (!seen.has(share.sharedToEmail)) {
        seen.add(share.sharedToEmail);
        recentRecipients.push({
          email: share.sharedToEmail,
          name: share.sharedToUser?.name || null,
          avatarUrl: share.sharedToUser?.avatarUrl || null,
          lastSharedAt: share.createdAt,
        });
      }
      if (recentRecipients.length >= 10) break;
    }

    // Merge: teammates first (excluding any already in recent), then recent
    const teammateEmails = new Set(teammates.map((t) => t.email.toLowerCase()));
    const filteredRecent = recentRecipients.filter(
      (r) => !teammateEmails.has(r.email.toLowerCase())
    );

    return NextResponse.json({
      teammates,
      recipients: filteredRecent,
    });
  } catch (error) {
    console.error("Get recent recipients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
