import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanFutureMeetingsForUser } from "@/lib/deals/scan-future-meetings";

export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const result = await scanFutureMeetingsForUser(user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[scan-future-meetings/sweep] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
