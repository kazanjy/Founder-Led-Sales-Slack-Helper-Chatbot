import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/admin";
import { SALES_READINESS_SEED } from "@/lib/sales-readiness/seed-data";

// POST — seed or update template items (admin only)
export async function POST() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let created = 0;
    let updated = 0;

    for (const item of SALES_READINESS_SEED) {
      // Check if item already exists by stage + category + title
      const existing = await prisma.salesReadinessItem.findFirst({
        where: {
          maturityStage: item.maturityStage,
          capabilityCategory: item.capabilityCategory,
          title: item.title,
        },
      });

      if (existing) {
        // Update order/description if changed
        await prisma.salesReadinessItem.update({
          where: { id: existing.id },
          data: {
            order: item.order,
            description: item.description || existing.description,
            mikeyLinks: item.mikeyLinks ? JSON.stringify(item.mikeyLinks) : existing.mikeyLinks,
          },
        });
        updated++;
      } else {
        await prisma.salesReadinessItem.create({
          data: {
            maturityStage: item.maturityStage,
            capabilityCategory: item.capabilityCategory,
            title: item.title,
            description: item.description || null,
            mikeyLinks: item.mikeyLinks ? JSON.stringify(item.mikeyLinks) : null,
            order: item.order,
          },
        });
        created++;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      total: SALES_READINESS_SEED.length,
    });
  } catch (error) {
    console.error("Error seeding readiness items:", error);
    return NextResponse.json({ error: "Failed to seed items" }, { status: 500 });
  }
}
