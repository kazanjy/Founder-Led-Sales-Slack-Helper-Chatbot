import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { title } = body;

    const collection = await prisma.salesMotionCollection.create({
      data: {
        userId: user.id,
        title: title || "Sales Motion Analysis",
      },
    });

    return NextResponse.json({
      collection: {
        id: collection.id,
        title: collection.title,
        status: collection.status,
      },
    });
  } catch (error) {
    console.error("Error creating sales motion collection:", error);
    return NextResponse.json(
      { error: "Failed to create collection" },
      { status: 500 }
    );
  }
}
