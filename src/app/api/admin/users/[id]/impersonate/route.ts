import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/admin";
import { randomBytes } from "crypto";

/**
 * POST /api/admin/users/[id]/impersonate
 *
 * Start impersonating a user. Creates a new session that logs the admin in as the target user
 * while tracking that it's an impersonation session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();

    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: targetUserId } = await params;

    // Don't allow impersonating yourself
    if (targetUserId === admin.id) {
      return NextResponse.json(
        { error: "Cannot impersonate yourself" },
        { status: 400 }
      );
    }

    // Find the target user
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Generate a new session token for impersonation
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create the impersonation session
    await prisma.session.create({
      data: {
        userId: targetUserId,
        token,
        expiresAt,
        impersonatingAdminId: admin.id,
      },
    });

    // Set the new session cookie
    const cookieStore = await cookies();
    cookieStore.set("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      message: `Now impersonating ${targetUser.name || targetUser.email || targetUser.slackUserName || "user"}`,
      redirectTo: "/chat",
    });
  } catch (error) {
    console.error("Impersonation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
