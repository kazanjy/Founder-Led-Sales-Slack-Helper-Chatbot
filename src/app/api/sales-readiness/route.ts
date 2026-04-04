import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Maturity stage ordering for display
const STAGE_ORDER: Record<string, number> = {
  PROBLEM_VALIDATION: 0,
  VALUE_VALIDATION: 1,
  WILL_SOMEONE_PAY: 2,
  FIRST_REVENUE: 3,
  REPEATABLE_REVENUE: 4,
  FIRST_SALES_HIRE: 5,
  SCALING_SALES: 6,
};

const STAGE_LABELS: Record<string, { short: string; question: string }> = {
  PROBLEM_VALIDATION: { short: "Problem Validation", question: "Do we know what problem we're solving?" },
  VALUE_VALIDATION: { short: "Value Validation", question: "Does the product solve the problem and create value?" },
  WILL_SOMEONE_PAY: { short: "Will Someone Pay", question: "Can we get someone to pay for the product?" },
  FIRST_REVENUE: { short: "First Revenue", question: "Can we get someone to pay for the product?" },
  REPEATABLE_REVENUE: { short: "Repeatable Revenue", question: "Can we get many people to pay for the product?" },
  FIRST_SALES_HIRE: { short: "First Sales Hire", question: "Can we get someone other than the founder to sell?" },
  SCALING_SALES: { short: "Scaling Sales", question: "Can we get many people other than the founder to sell?" },
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!user.accountId) {
      return NextResponse.json({ error: "No account found. Please contact support." }, { status: 400 });
    }

    // Fetch all template items
    const items = await prisma.salesReadinessItem.findMany({
      orderBy: [{ maturityStage: "asc" }, { capabilityCategory: "asc" }, { order: "asc" }],
    });

    // Fetch account progress for all items
    const accountItems = await prisma.salesReadinessAccountItem.findMany({
      where: { accountId: user.accountId },
    });

    // Build a map of itemId -> account progress
    const progressMap = new Map(accountItems.map((ai) => [ai.itemId, ai]));

    // Fetch user names for statusChangedBy
    const changedByIds = [...new Set(accountItems.filter((ai) => ai.statusChangedBy).map((ai) => ai.statusChangedBy!))];
    const changedByUsers = changedByIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: changedByIds } },
          select: { id: true, name: true, slackUserName: true, email: true },
        })
      : [];
    const userNameMap = new Map(changedByUsers.map((u) => [u.id, u.name || u.slackUserName || u.email || "Unknown"]));

    // Get user's current maturity stage
    const maturityStage = await prisma.salesMaturityStage.findUnique({
      where: { userId: user.id },
    });

    // Group by stage → category → items
    const stageMap = new Map<string, Map<string, Array<{
      id: string;
      title: string;
      description: string | null;
      order: number;
      status: string;
      statusChangedAt: string | null;
      statusChangedByName: string | null;
      completedAt: string | null;
      notes: string | null;
    }>>>();

    for (const item of items) {
      if (!stageMap.has(item.maturityStage)) {
        stageMap.set(item.maturityStage, new Map());
      }
      const catMap = stageMap.get(item.maturityStage)!;
      if (!catMap.has(item.capabilityCategory)) {
        catMap.set(item.capabilityCategory, []);
      }

      const progress = progressMap.get(item.id);
      catMap.get(item.capabilityCategory)!.push({
        id: item.id,
        title: item.title,
        description: item.description,
        order: item.order,
        status: progress?.status || "to_do",
        statusChangedAt: progress?.statusChangedAt?.toISOString() || null,
        statusChangedByName: progress?.statusChangedBy ? userNameMap.get(progress.statusChangedBy) || null : null,
        completedAt: progress?.completedAt?.toISOString() || null,
        notes: progress?.notes || null,
      });
    }

    // Convert to sorted array
    const stages = [...stageMap.entries()]
      .sort((a, b) => (STAGE_ORDER[a[0]] ?? 99) - (STAGE_ORDER[b[0]] ?? 99))
      .map(([stageKey, catMap]) => {
        const categories = [...catMap.entries()].map(([catName, catItems]) => ({
          name: catName,
          items: catItems.sort((a, b) => a.order - b.order),
          doneCount: catItems.filter((i) => i.status === "done").length,
          totalCount: catItems.length,
        }));

        const allItems = categories.flatMap((c) => c.items);
        return {
          key: stageKey,
          label: STAGE_LABELS[stageKey]?.short || stageKey,
          question: STAGE_LABELS[stageKey]?.question || "",
          categories,
          doneCount: allItems.filter((i) => i.status === "done").length,
          totalCount: allItems.length,
        };
      });

    // Overall stats
    const allItems = stages.flatMap((s) => s.categories.flatMap((c) => c.items));
    const overall = {
      done: allItems.filter((i) => i.status === "done").length,
      upNext: allItems.filter((i) => i.status === "up_next").length,
      deferred: allItems.filter((i) => i.status === "deferred").length,
      notDoing: allItems.filter((i) => i.status === "not_doing").length,
      toDo: allItems.filter((i) => i.status === "to_do").length,
      total: allItems.length,
    };

    return NextResponse.json({
      stages,
      overall,
      currentMaturityStage: maturityStage?.currentStage || null,
    });
  } catch (error) {
    console.error("Error fetching sales readiness:", error);
    return NextResponse.json({ error: "Failed to fetch checklist" }, { status: 500 });
  }
}
