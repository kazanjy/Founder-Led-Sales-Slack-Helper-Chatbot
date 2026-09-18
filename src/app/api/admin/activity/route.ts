import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { fetchRecentActivity } from "@/lib/activity/recent";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
    const pageSize = parseInt(request.nextUrl.searchParams.get("pageSize") || "30");

    const items = await fetchRecentActivity({ perType: Math.max(pageSize, 30) });

    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return NextResponse.json({
      activity: paged,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Admin activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
