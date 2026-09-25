import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { computeOnboardingState } from "@/lib/onboarding/state";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const state = await computeOnboardingState(user.id);
  return NextResponse.json(state);
}
