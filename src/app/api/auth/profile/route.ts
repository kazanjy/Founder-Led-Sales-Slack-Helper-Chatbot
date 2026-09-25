import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/auth/profile - Update current user's profile
 */
export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, email } = body;

    // Build update data
    const updateData: { name?: string; email?: string } = {};

    if (name !== undefined) {
      updateData.name = name.trim() || null;
    }

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();

      // Check if email is already taken by another user
      if (normalizedEmail) {
        const existingUser = await prisma.user.findFirst({
          where: {
            email: normalizedEmail,
            id: { not: user.id },
          },
        });

        if (existingUser) {
          return NextResponse.json(
            { error: "This email is already associated with another account" },
            { status: 409 }
          );
        }
      }

      updateData.email = normalizedEmail || null;
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    return NextResponse.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
