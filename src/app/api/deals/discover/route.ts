import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { discoverDealsForUser } from "@/lib/deals/discover";

// Manual deal discovery. Sweeps the user's recorder (latest 50 calls)
// and last 30 days of external calendar events, routing each through
// the shared auto-detect helper.
export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const summary = await discoverDealsForUser(user.id);
  return NextResponse.json(summary);
}
