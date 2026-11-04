import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

/**
 * POST /api/auth/exit-impersonation
 *
 * Exit impersonation mode. Deletes the impersonation session and restores
 * the admin's own session.
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("session")?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "No session found" },
        { status: 401 }
      );
    }

    // Find the current session
    const currentSession = await prisma.session.findUnique({
      where: { token: sessionToken },
    });

    if (!currentSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 401 }
      );
    }

    // Check if this is an impersonation session
    if (!currentSession.impersonatingAdminId) {
      return NextResponse.json(
        { error: "Not currently impersonating" },
        { status: 400 }
      );
    }

    const adminId = currentSession.impersonatingAdminId;

    // Delete the impersonation session
    await prisma.session.delete({
      where: { id: currentSession.id },
    });

    // Find an existing non-impersonation session for the admin
    let adminSession = await prisma.session.findFirst({
      where: {
        userId: adminId,
        impersonatingAdminId: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    // If no existing admin session, create a new one
    if (!adminSession) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      adminSession = await prisma.session.create({
        data: {
          userId: adminId,
          token,
          expiresAt,
        },
      });
    }

    // Set the admin session cookie
    cookieStore.set("session", adminSession.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: adminSession.expiresAt,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      message: "Exited impersonation mode",
      redirectTo: "/admin/users",
    });
  } catch (error) {
    console.error("Exit impersonation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
