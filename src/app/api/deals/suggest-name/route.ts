import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { suggestDealNameFromCalls, type SuggestNameInput } from "@/lib/deals/suggest-name";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { calls } = (await request.json()) as { calls: SuggestNameInput[] };
    if (!calls?.length) {
      return NextResponse.json({ error: "No calls provided" }, { status: 400 });
    }

    const result = await suggestDealNameFromCalls(calls);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error suggesting deal name:", error);
    return NextResponse.json({ companyName: "", dealName: "" });
  }
}
