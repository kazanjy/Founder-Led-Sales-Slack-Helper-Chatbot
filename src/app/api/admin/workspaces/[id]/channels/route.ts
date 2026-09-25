import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { getSlackClient } from "@/lib/slack/client";

/**
 * GET /api/admin/workspaces/[id]/channels
 * List public Slack channels for a workspace (by internal workspace ID).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const workspace = await prisma.workspace.findUnique({
      where: { id },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const client = getSlackClient(workspace.botToken);

    const result = await client.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
    });

    const channels = (result.channels || [])
      .filter((ch) => ch.id && ch.name)
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Admin list workspace channels error:", error);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}
