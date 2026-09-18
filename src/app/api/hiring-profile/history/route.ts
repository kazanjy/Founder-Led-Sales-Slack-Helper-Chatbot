import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseHiringRole } from "@/lib/hiring/role-types";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // roleType omitted = every seat, so the history page can list all
    // three profiles together if it wants to.
    const roleParam = new URL(request.url).searchParams.get("roleType");
    const versions = await prisma.hiringProfileVersion.findMany({
      where: { userId: user.id, ...(roleParam ? { roleType: parseHiringRole(roleParam) } : {}) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        roleType: true,
        createdAt: true,
        updatedAt: true,
        iterationHistory: true,
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error fetching hiring profile history:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
