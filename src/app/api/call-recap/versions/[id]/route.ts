import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const version = await prisma.callRecapVersion.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true },
        },
      },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Check access — same account
    if (version.userId !== user.id) {
      const sameAccount = await prisma.user.findFirst({
        where: {
          id: version.userId,
          accountId: user.accountId || undefined,
        },
      });
      if (!sameAccount) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    return NextResponse.json({
      currentUserId: user.id,
      version: {
        id: version.id,
        userId: version.userId,
        recordingUrl: version.recordingUrl,
        callSummary: version.callSummary,
        callTranscript: version.callTranscript,
        customNotes: version.customNotes,
        title: version.title,
        callType: version.callType,
        emailSubject: version.emailSubject,
        emailBody: version.emailBody,
        iterationHistory: version.iterationHistory,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching call recap version:", error);
    return NextResponse.json(
      { error: "Failed to fetch call recap version" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { emailSubject, emailBody, title } = body;

    const version = await prisma.callRecapVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const updateData: { emailSubject?: string; emailBody?: string; title?: string } = {};
    if (emailSubject !== undefined) updateData.emailSubject = emailSubject;
    if (emailBody !== undefined) updateData.emailBody = emailBody;
    if (title !== undefined) updateData.title = title;

    const updated = await prisma.callRecapVersion.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        title: updated.title,
        callType: updated.callType,
        emailSubject: updated.emailSubject,
        emailBody: updated.emailBody,
        iterationHistory: updated.iterationHistory,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating call recap version:", error);
    return NextResponse.json(
      { error: "Failed to update call recap version" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const version = await prisma.callRecapVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.callRecapVersion.delete({
      where: { id },
    });

    // Check if there are remaining versions
    const newLatest = await prisma.callRecapVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, hasRemaining: !!newLatest });
  } catch (error) {
    console.error("Error deleting call recap version:", error);
    return NextResponse.json(
      { error: "Failed to delete version" },
      { status: 500 }
    );
  }
}
