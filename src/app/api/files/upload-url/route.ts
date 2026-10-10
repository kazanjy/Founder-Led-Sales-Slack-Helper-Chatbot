import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { createSignedUploadUrl } from "@/lib/supabase";

/**
 * POST /api/files/upload-url — Generate signed Supabase upload URLs.
 *
 * The client uploads directly to Supabase using these URLs, bypassing the
 * Next.js App Router 1 MB request body limit for route handlers.
 *
 * Body: { files: [{ name: string }], source?: string }
 * Returns: { files: [{ name, type, storagePath, signedUrl, token }] }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { files, source = "upload" } = body as {
      files: { name: string }[];
      source?: string;
    };

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files specified" }, { status: 400 });
    }

    const results: Array<{
      name: string;
      type: string;
      storagePath: string;
      signedUrl: string;
      token: string;
    }> = [];

    for (const file of files) {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(file.name);

      if (!isPdf && !isImage) {
        continue;
      }

      const fileType = isPdf ? "pdf" : "image";
      const signed = await createSignedUploadUrl(user.id, file.name, fileType as "pdf" | "image");

      // Pre-create the DB record so the storage path is tracked
      await prisma.userFile.create({
        data: {
          userId: user.id,
          name: file.name,
          type: fileType,
          storagePath: signed.storagePath,
          source,
        },
      });

      results.push({
        name: file.name,
        type: fileType,
        storagePath: signed.storagePath,
        signedUrl: signed.signedUrl,
        token: signed.token,
      });
    }

    return NextResponse.json({ files: results });
  } catch (error) {
    console.error("[UploadURL] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URLs" },
      { status: 500 }
    );
  }
}
