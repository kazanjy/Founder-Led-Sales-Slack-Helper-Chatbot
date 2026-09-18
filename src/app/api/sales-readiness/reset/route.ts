import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST — reset all readiness progress for the account
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const body = await request.json();
    if (body.confirmation !== "RESET") {
      return NextResponse.json({ error: "Invalid confirmation. Type RESET to confirm." }, { status: 400 });
    }

    // Delete all account progress items (template items remain)
    const result = await prisma.salesReadinessAccountItem.deleteMany({
      where: { accountId: user.accountId },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Error resetting readiness:", error);
    return NextResponse.json({ error: "Failed to reset" }, { status: 500 });
  }
}
