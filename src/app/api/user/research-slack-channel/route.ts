import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * PUT /api/user/research-slack-channel
 *
 * Set or clear the user's preferred pre-call research Slack
 * channel. Body: `{ channelId, channelName }` to set, or `{}` /
 * `{ channelId: null }` to clear (e.g. when the user clicks "Change"
 * in the picker to wipe the saved choice).
 */
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as { channelId?: string | null; channelName?: string | null };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      preferredResearchSlackChannelId: body.channelId || null,
      preferredResearchSlackChannelName: body.channelName || null,
    },
  });

  return NextResponse.json({ ok: true });
}
