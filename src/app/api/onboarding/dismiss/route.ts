import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dismissStep, OnboardingStep } from "@/lib/onboarding/state";

const VALID_STEPS: OnboardingStep[] = ["recorder", "calendar", "narrative"];

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { step, kind } = await request.json();

  if (!VALID_STEPS.includes(step)) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  if (kind !== "once" && kind !== "forever") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  await dismissStep(user.id, step, kind);
  return NextResponse.json({ success: true });
}
