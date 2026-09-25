import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { uploadStandaloneFile, getFileUrl } from "@/lib/supabase";
import {
  extractCollateralText,
  isSupportedCollateralUpload,
} from "@/lib/collateral/extract";
import { isPDFMimeType } from "@/lib/pdf-server";

/**
 * POST /api/sales-asset-library/[id]/versions/upload
 *
 * Companion to the URL-based POST /versions endpoint. Accepts a
 * multipart/form-data payload with a `file` field (PDF or DOCX),
 * extracts text server-side, stores the blob in Supabase Storage,
 * and creates a SalesAssetVersion row linked to the extracted text
 * + storage path. The signed storage URL is stored as `url` on the
 * version so existing "click to open" affordances keep working.
 *
 * Multipart-body fields:
 *   file:   the PDF/DOCX to upload (required)
 *   label:  optional short label (e.g. "v3.2")
 *   notes:  optional notes on this version
 */

export const maxDuration = 120;

async function verifyAccess(id: string, accountId: string) {
  const asset = await prisma.salesAsset.findUnique({ where: { id } });
  if (!asset || asset.accountId !== accountId) return null;
  return asset;
}

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

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    if (!isSupportedCollateralUpload(file.name, file.type)) {
      return NextResponse.json(
        {
          error:
            "Only PDF and .docx uploads are supported. Legacy .doc / .ppt / .pptx / etc. aren't parseable in this pipeline yet.",
        },
        { status: 415 }
      );
    }

    const label = typeof form.get("label") === "string" ? String(form.get("label")).trim() : "";
    const notes = typeof form.get("notes") === "string" ? String(form.get("notes")).trim() : "";

    // 1) Ingest the buffer + extract text server-side. If extraction
    //    fails we still allow the upload (URL-only) so the founder can
    //    at least link to the doc — but we record the failure so a
    //    future OCR / re-parse pass can retry.
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extraction = await extractCollateralText(buffer, file.name, file.type);
    if (extraction.status === "failed") {
      console.warn(
        `[collateral upload] extraction failed for ${file.name}: ${extraction.reason}`
      );
    }

    // 2) Upload the blob to Supabase Storage. Uses the standalone
    //    uploader so the path lives under the current user's namespace;
    //    access is gated by the version row (account-scoped) anyway.
    const stored = await uploadStandaloneFile(user.id, {
      name: file.name,
      type: isPDFMimeType(file.type) ? "pdf" : "pdf", // supabase.ts type union is "image" | "pdf"; DOCX rides in the pdf slot
      buffer,
      mimeType: file.type || "application/octet-stream",
    });

    // 3) Signed URL for the version's `url` field so the existing
    //    "click through" UX keeps working with no branching.
    const signedUrl = (await getFileUrl(stored.storagePath)) || stored.storagePath;

    // 4) Persist. New columns: fileStoragePath, fileMimeType, fileBytes,
    //    extractedText, extractTextStatus, pageCount, extractedAt.
    const version = await prisma.salesAssetVersion.create({
      data: {
        assetId: id,
        url: signedUrl,
        label: label || file.name,
        notes: notes || null,
        fileStoragePath: stored.storagePath,
        fileMimeType: file.type || null,
        fileBytes: file.size,
        extractedText: extraction.text || null,
        extractTextStatus: extraction.status,
        pageCount: extraction.pageCount ?? null,
        extractedAt: new Date(),
        createdByUserId: user.id,
      },
      include: {
        createdByUser: { select: { name: true, email: true, slackUserName: true } },
      },
    });

    // 5) Denormalized "current" pointer on the asset.
    await prisma.salesAsset.update({
      where: { id },
      data: {
        currentUrl: version.url,
        currentLabel: version.label,
        currentVersionId: version.id,
      },
    });

    console.log(
      `[collateral upload] asset=${id} version=${version.id} status=${extraction.status} chars=${(extraction.text || "").length}${extraction.reason ? ` reason=${extraction.reason}` : ""}`
    );

    return NextResponse.json({
      version,
      extraction: {
        status: extraction.status,
        chars: (extraction.text || "").length,
        pageCount: extraction.pageCount,
        reason: extraction.reason,
      },
    });
  } catch (error) {
    console.error("[collateral upload] error:", error);
    return NextResponse.json({ error: "Failed to upload version" }, { status: 500 });
  }
}
