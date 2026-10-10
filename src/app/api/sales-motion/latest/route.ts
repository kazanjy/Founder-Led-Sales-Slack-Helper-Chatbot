import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const collection = await prisma.salesMotionCollection.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        deals: {
          orderBy: { dealOrder: "asc" },
          include: {
            calls: {
              orderBy: { callOrder: "asc" },
            },
          },
        },
        scripts: true,
      },
    });

    if (!collection) {
      return NextResponse.json({ hasCollection: false, collection: null });
    }

    return NextResponse.json({ hasCollection: true, collection });
  } catch (error) {
    console.error("Error fetching latest sales motion collection:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest collection" },
      { status: 500 }
    );
  }
}
