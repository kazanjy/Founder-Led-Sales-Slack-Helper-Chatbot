import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { executeDealTaskViaSlack } from "@/lib/deals/task-execution";

/**
 * GET /deals/[id]/tasks/[taskId]/do — the "🚀 Do it" link on the
 * ⚡ Proposed Task Execution ping. Sends the task's drafted message
 * into the deal's linked Slack channel as the founder, logs the
 * timeline proof entry, marks the task done, and lands on the deal.
 * Unauthenticated hits (Slack's link crawler) redirect untouched.
 * Owner-only — the message sends AS the founder.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;
  const dealUrl = new URL(`/deals/${id}`, request.nextUrl.origin);
  const user = await getCurrentUser();
  if (user) {
    try {
      const result = await executeDealTaskViaSlack(user.id, taskId);
      if (!result.ok) {
        console.error(`[task do] execution failed for ${taskId}: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[task do] execution threw for ${taskId}:`, err);
    }
  }
  return NextResponse.redirect(dealUrl);
}
