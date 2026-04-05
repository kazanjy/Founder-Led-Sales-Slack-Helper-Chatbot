import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const MERGE_FIELD = "SALES_READINESS_UI_STATE";

// PUT — save UI collapse state (account-scoped — writes for all users in account)
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { expandedStages, collapsedCategories } = await request.json();
    const value = JSON.stringify({ expandedStages, collapsedCategories });

    // Get all users in the account
    const accountUsers = user.accountId
      ? await prisma.user.findMany({ where: { accountId: user.accountId }, select: { id: true } })
      : [{ id: user.id }];

    // Upsert for all users in the account so everyone sees the same state
    await Promise.all(
      accountUsers.map((u) =>
        prisma.gtmVariable.upsert({
          where: { userId_mergeField: { userId: u.id, mergeField: MERGE_FIELD } },
          update: { value },
          create: {
            userId: u.id,
            mergeField: MERGE_FIELD,
            name: "Sales Readiness UI State",
            value,
            isDefault: false,
          },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving readiness UI state:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
