import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Load the tone guidance value
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const variable = await prisma.gtmVariable.findFirst({
      where: { userId: user.id, mergeField: "RECAP_TONE_GUIDANCE" },
      select: { value: true },
    });

    return NextResponse.json({ value: variable?.value || "" });
  } catch (error) {
    console.error("[call-recap/tone] GET error:", error);
    return NextResponse.json({ value: "" });
  }
}

// POST - Save/update the tone guidance value
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { value } = await request.json();

    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "RECAP_TONE_GUIDANCE",
        },
      },
      update: { value: value || "" },
      create: {
        userId: user.id,
        mergeField: "RECAP_TONE_GUIDANCE",
        name: "Recap Email Tone Guidance",
        value: value || "",
        isDefault: false,
        sortOrder: 999,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[call-recap/tone] POST error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
