import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    const result = await runDealAnalysis(user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DealNotFoundError) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    console.error("Error analyzing deal:", error);
    return NextResponse.json({ error: "Failed to analyze deal" }, { status: 500 });
  }
}
