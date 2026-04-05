import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const MERGE_FIELD = "SALES_READINESS_UI_STATE";

// PUT — save UI collapse state (account-scoped via GTM variable)
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { expandedStages, collapsedCategories } = await request.json();

    const value = JSON.stringify({ expandedStages, collapsedCategories });

    await prisma.gtmVariable.upsert({
      where: { userId_mergeField: { userId: user.id, mergeField: MERGE_FIELD } },
      update: { value },
      create: {
        userId: user.id,
        mergeField: MERGE_FIELD,
        name: "Sales Readiness UI State",
        value,
        isDefault: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving readiness UI state:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
