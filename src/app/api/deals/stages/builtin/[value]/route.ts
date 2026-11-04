import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { DEAL_STAGES } from "@/lib/deals/constants";

/**
 * PATCH /api/deals/stages/builtin/[value]
 *
 * Toggle whether a built-in deal stage is hidden from the account's
 * pipeline picker. Body: { archived: boolean }. The value param must
 * match one of DEAL_STAGES (case-sensitive). Existing deals on the
 * stage keep it — resolveStage on the client still resolves the label
 * so cards render correctly. Only the picker chip hides.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ value: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.accountId) {
    return NextResponse.json({ error: "No account" }, { status: 400 });
  }
  const { value } = await params;
  if (!DEAL_STAGES.some((s) => s.value === value)) {
    return NextResponse.json({ error: "Unknown built-in stage" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const archived = body.archived === true;

  try {
    const current = await prisma.account.findUnique({
      where: { id: user.accountId },
      select: { archivedBuiltinStages: true },
    });
    const existing = current?.archivedBuiltinStages ?? [];
    const next = archived
      ? Array.from(new Set([...existing, value]))
      : existing.filter((v) => v !== value);

    await prisma.account.update({
      where: { id: user.accountId },
      data: { archivedBuiltinStages: next },
    });

    return NextResponse.json({ archivedBuiltinStages: next });
  } catch (err) {
    console.error("[stages/builtin] update failed:", err);
    return NextResponse.json(
      { error: "Failed to update — has the archivedBuiltinStages migration been run?" },
      { status: 500 }
    );
  }
}
