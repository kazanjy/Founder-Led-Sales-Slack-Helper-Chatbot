import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";

export async function GET() {
  try {
    const admin = await getAdminUser();

    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: admin.id,
        email: admin.email || admin.slackEmail,
        name: admin.name || admin.slackUserName,
      },
    });
  } catch (error) {
    console.error("Admin me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
