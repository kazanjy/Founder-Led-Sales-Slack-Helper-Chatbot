import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/admin";
import { findOrCreateAccountForUser } from "@/lib/accounts";

/**
 * GET /api/admin/accounts/migrate-solo-users
 * Returns a count of solo users (no account) that can be migrated.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const soloUsers = await prisma.user.findMany({
    where: { accountId: null },
    select: {
      id: true,
      email: true,
      slackEmail: true,
      name: true,
      slackUserName: true,
    },
  });

  const withEmail = soloUsers.filter((u) => u.email || u.slackEmail);
  const withoutEmail = soloUsers.filter((u) => !u.email && !u.slackEmail);

  return NextResponse.json({
    total: soloUsers.length,
    migratable: withEmail.length,
    noEmail: withoutEmail.length,
    users: soloUsers.map((u) => ({
      id: u.id,
      email: u.email || u.slackEmail || null,
      name: u.name || u.slackUserName || null,
      hasEmail: !!(u.email || u.slackEmail),
    })),
  });
}

/**
 * POST /api/admin/accounts/migrate-solo-users
 * Migrates all solo users (no account) to accounts based on email domain.
 * Users without an email are skipped.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const soloUsers = await prisma.user.findMany({
    where: { accountId: null },
    select: {
      id: true,
      email: true,
      slackEmail: true,
      name: true,
      slackUserName: true,
    },
  });

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const u of soloUsers) {
    const email = u.email || u.slackEmail;
    if (!email) {
      skipped++;
      continue;
    }

    try {
      await findOrCreateAccountForUser(u.id, email, u.name || u.slackUserName);
      migrated++;
    } catch (err) {
      console.error(`[Migration] Failed to migrate user ${u.id}:`, err);
      errors++;
    }
  }

  console.log(
    `[Migration] Bulk migration complete: ${migrated} migrated, ${skipped} skipped (no email), ${errors} errors`
  );

  return NextResponse.json({ migrated, skipped, errors });
}
