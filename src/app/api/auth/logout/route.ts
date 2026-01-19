import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (sessionToken) {
    // Delete session from database
    await prisma.session
      .delete({
        where: { token: sessionToken },
      })
      .catch(() => {
        // Session might not exist, that's ok
      });

    // Clear cookie
    cookieStore.delete("session");
  }

  return NextResponse.json({ success: true });
}
