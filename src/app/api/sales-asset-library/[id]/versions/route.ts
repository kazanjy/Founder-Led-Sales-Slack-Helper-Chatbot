import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function verifyAccess(id: string, accountId: string) {
  const asset = await prisma.salesAsset.findUnique({ where: { id } });
  if (!asset || asset.accountId !== accountId) return null;
  return asset;
}

// GET — list all versions for an asset
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const asset = await verifyAccess(id, user.accountId);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const versions = await prisma.salesAssetVersion.findMany({
      where: { assetId: id },
      orderBy: { createdAt: "desc" },
      include: {
        createdByUser: { select: { name: true, email: true, slackUserName: true } },
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error fetching asset versions:", error);
    return NextResponse.json({ error: "Failed to fetch versions" }, { status: 500 });
  }
}

// POST — create a new version (= update URL)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const asset = await verifyAccess(id, user.accountId);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const { url, label, notes } = (await request.json()) as {
      url: string;
      label?: string;
      notes?: string;
    };

    if (!url?.trim()) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const version = await prisma.salesAssetVersion.create({
      data: {
        assetId: id,
        url: url.trim(),
        label: label?.trim() || null,
        notes: notes?.trim() || null,
        createdByUserId: user.id,
      },
      include: {
        createdByUser: { select: { name: true, email: true, slackUserName: true } },
      },
    });

    // Update denormalized current fields on the asset
    await prisma.salesAsset.update({
      where: { id },
      data: {
        currentUrl: version.url,
        currentLabel: version.label,
        currentVersionId: version.id,
      },
    });

    return NextResponse.json({ version });
  } catch (error) {
    console.error("Error creating asset version:", error);
    return NextResponse.json({ error: "Failed to create version" }, { status: 500 });
  }
}
