import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFileUrl, type StoredFileReference } from "@/lib/supabase";

/**
 * GET /api/files — List all uploaded files (from conversations + standalone uploads),
 * most recent first, with signed URLs and links to the parent conversation (if any).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const typeFilter = searchParams.get("type"); // "image" | "pdf" | null (all)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = 30;

    interface FileEntry {
      name: string;
      type: "image" | "pdf";
      storagePath: string;
      pageCount?: number;
      conversationId: string | null;
      conversationTitle: string | null;
      date: Date;
      source?: string;
    }

    const allFiles: FileEntry[] = [];

    // 1. Files from conversations (imagesIncluded JSON)
    const conversations = await prisma.conversation.findMany({
      where: {
        userId: user.id,
        imagesIncluded: { not: Prisma.JsonNull },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        imagesIncluded: true,
      },
    });

    for (const conv of conversations) {
      const files = conv.imagesIncluded as StoredFileReference[] | null;
      if (!files || !Array.isArray(files)) continue;

      for (const file of files) {
        if (typeFilter && file.type !== typeFilter) continue;

        allFiles.push({
          name: file.name,
          type: file.type,
          storagePath: file.storagePath,
          pageCount: file.pageCount,
          conversationId: conv.id,
          conversationTitle: conv.title,
          date: conv.updatedAt,
        });
      }
    }

    // 2. Standalone uploaded files (UserFile records)
    const standaloneFiles = await prisma.userFile.findMany({
      where: {
        userId: user.id,
        ...(typeFilter ? { type: typeFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    for (const file of standaloneFiles) {
      allFiles.push({
        name: file.name,
        type: file.type as "image" | "pdf",
        storagePath: file.storagePath,
        pageCount: file.pageCount ?? undefined,
        conversationId: null,
        conversationTitle: null,
        date: file.createdAt,
        source: file.source,
      });
    }

    // Sort all files by date, most recent first
    allFiles.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Paginate
    const totalFiles = allFiles.length;
    const totalPages = Math.ceil(totalFiles / pageSize);
    const paginatedFiles = allFiles.slice((page - 1) * pageSize, page * pageSize);

    // Generate signed URLs for the current page of files
    const filesWithUrls = await Promise.all(
      paginatedFiles.map(async (file) => {
        if (file.type === "pdf" && file.pageCount) {
          // For conversation PDFs stored as page images, get the first page as thumbnail
          const firstPagePath = `${file.storagePath}/page-001.jpg`;
          const thumbnailUrl = await getFileUrl(firstPagePath);
          return {
            ...file,
            thumbnailUrl,
            url: null,
          };
        } else if (file.type === "pdf") {
          // For standalone PDFs (raw file, not page images), get the file URL directly
          const url = await getFileUrl(file.storagePath);
          return {
            ...file,
            url,
            thumbnailUrl: null, // No image thumbnail for raw PDFs
          };
        } else {
          // For images, get the direct URL
          const url = await getFileUrl(file.storagePath);
          return {
            ...file,
            url,
            thumbnailUrl: url,
          };
        }
      })
    );

    return NextResponse.json({
      files: filesWithUrls,
      pagination: {
        page,
        pageSize,
        totalFiles,
        totalPages,
      },
    });
  } catch (error) {
    console.error("[Files API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 }
    );
  }
}
