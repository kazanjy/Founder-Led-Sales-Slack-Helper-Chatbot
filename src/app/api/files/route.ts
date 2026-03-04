import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFileUrl, getPDFPageUrls, type StoredFileReference } from "@/lib/supabase";

/**
 * GET /api/files — List all uploaded files across the user's conversations,
 * most recent first, with signed URLs and links to the parent conversation.
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

    // Get all conversations that have files, ordered by most recent activity
    const conversations = await prisma.conversation.findMany({
      where: {
        userId: user.id,
        imagesIncluded: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        imagesIncluded: true,
      },
    });

    // Flatten files from all conversations, keeping conversation context
    interface FileEntry {
      name: string;
      type: "image" | "pdf";
      storagePath: string;
      pageCount?: number;
      conversationId: string;
      conversationTitle: string | null;
      conversationDate: Date;
    }

    const allFiles: FileEntry[] = [];

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
          conversationDate: conv.updatedAt,
        });
      }
    }

    // Paginate
    const totalFiles = allFiles.length;
    const totalPages = Math.ceil(totalFiles / pageSize);
    const paginatedFiles = allFiles.slice((page - 1) * pageSize, page * pageSize);

    // Generate signed URLs for the current page of files
    const filesWithUrls = await Promise.all(
      paginatedFiles.map(async (file) => {
        if (file.type === "pdf" && file.pageCount) {
          // For PDFs, get the first page as a thumbnail
          const firstPagePath = `${file.storagePath}/page-001.jpg`;
          const thumbnailUrl = await getFileUrl(firstPagePath);
          return {
            ...file,
            thumbnailUrl,
            url: null,
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
