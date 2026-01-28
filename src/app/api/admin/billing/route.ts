import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get license stats
    const [
      totalLicenses,
      activeLicenses,
      manualLicenses,
      stripeLicenses,
      licensesWithUsers,
    ] = await Promise.all([
      prisma.license.count(),
      prisma.license.count({ where: { status: "ACTIVE" } }),
      prisma.license.count({ where: { manuallyGranted: true } }),
      prisma.license.count({ where: { stripeSubscriptionId: { not: null } } }),
      prisma.license.findMany({
        where: { status: "ACTIVE" },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              slackEmail: true,
              name: true,
              slackUserName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    // Get users with active license status
    const activeUsers = await prisma.user.count({
      where: { licenseStatus: "ACTIVE" },
    });

    // Calculate rough MRR (assuming $99/user for simplicity)
    // In a real app, you'd fetch actual subscription amounts from Stripe
    const estimatedMRR = stripeLicenses * 99;

    const recentLicenses = licensesWithUsers.map((license: typeof licensesWithUsers[number]) => ({
      id: license.id,
      type: license.type,
      status: license.status,
      expiresAt: license.expiresAt,
      stripeSubscriptionId: license.stripeSubscriptionId,
      stripeCustomerId: license.stripeCustomerId,
      manuallyGranted: license.manuallyGranted,
      notes: license.notes,
      createdAt: license.createdAt,
      users: license.users.map((u: typeof license.users[number]) => ({
        id: u.id,
        email: u.email || u.slackEmail,
        name: u.name || u.slackUserName,
      })),
    }));

    return NextResponse.json({
      stats: {
        totalLicenses,
        activeLicenses,
        manualLicenses,
        stripeLicenses,
        activeUsers,
        estimatedMRR,
      },
      recentLicenses,
    });
  } catch (error) {
    console.error("Admin billing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
