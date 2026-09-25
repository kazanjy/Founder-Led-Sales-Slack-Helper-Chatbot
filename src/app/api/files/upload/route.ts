import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { uploadStandaloneFile } from "@/lib/supabase";

// Allow up to 60s for large file uploads
export const maxDuration = 60;

/**
 * POST /api/files/upload — Upload files to Supabase and store references.
 * Accepts multipart/form-data with `files` (multiple) and optional `source` string.
 * Returns the created UserFile records with storage paths.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const source = (formData.get("source") as string) || "upload";

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results: Array<{
      id: string;
      name: string;
      type: string;
      storagePath: string;
    }> = [];

    for (const file of files) {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const isImage = file.type.startsWith("image/");

      if (!isPdf && !isImage) {
        console.warn(`[Upload] Skipping unsupported file: ${file.name} (${file.type})`);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileType = isPdf ? "pdf" : "image";

      // Upload to Supabase
      const ref = await uploadStandaloneFile(user.id, {
        name: file.name,
        type: fileType,
        buffer,
        mimeType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
      });

      // Create DB record
      const userFile = await prisma.userFile.create({
        data: {
          userId: user.id,
          name: ref.name,
          type: ref.type,
          storagePath: ref.storagePath,
          source,
        },
      });

      results.push({
        id: userFile.id,
        name: userFile.name,
        type: userFile.type,
        storagePath: userFile.storagePath,
      });
    }

    console.log(`[Upload] Uploaded ${results.length} files for user ${user.id} (source: ${source})`);

    return NextResponse.json({ files: results });
  } catch (error) {
    console.error("[Upload] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload files" },
      { status: 500 }
    );
  }
}
