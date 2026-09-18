import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (q.length < 2) {
      return NextResponse.json({ users: [], accounts: [] });
    }

    const [users, accounts] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { slackUserName: { contains: q, mode: "insensitive" } },
            { slackEmail: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          licenseStatus: true,
        },
        take: 5,
        orderBy: { lastActiveAt: { sort: "desc", nulls: "last" } },
      }),
      prisma.account.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { emailDomain: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          emailDomain: true,
          _count: { select: { users: true } },
        },
        take: 5,
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        licenseStatus: u.licenseStatus,
      })),
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        emailDomain: a.emailDomain,
        userCount: a._count.users,
      })),
    });
  } catch (error) {
    console.error("Admin search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
