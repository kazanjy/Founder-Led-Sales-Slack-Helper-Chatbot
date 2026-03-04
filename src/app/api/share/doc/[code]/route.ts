import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    const sharedDoc = await prisma.sharedDocument.findUnique({
      where: { shareCode: code },
    });

    if (!sharedDoc) {
      return NextResponse.json({ error: "Shared document not found" }, { status: 404 });
    }

    // Increment view count
    await prisma.sharedDocument.update({
      where: { id: sharedDoc.id },
      data: { viewCount: { increment: 1 } },
    });

    return NextResponse.json({
      document: {
        documentType: sharedDoc.documentType,
        title: sharedDoc.title,
        content: sharedDoc.content,
        createdAt: sharedDoc.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching shared document:", error);
    return NextResponse.json({ error: "Failed to fetch shared document" }, { status: 500 });
  }
}
