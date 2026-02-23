import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  uploadFile,
  uploadPDFPages,
  getFileUrl,
  getPDFPageUrls,
  type StoredFileReference,
} from "@/lib/supabase";

interface UploadRequest {
  files: {
    name: string;
    type: "image" | "pdf";
    dataUrl: string; // base64 data URL
    pdfPages?: string[]; // For PDFs, array of page data URLs
  }[];
}

// POST - Upload files to storage and save references
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify user owns this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: user.id,
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const body: UploadRequest = await request.json();
    const { files } = body;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    console.log(`[Attachments] Uploading ${files.length} files for conversation ${conversationId}`);

    const storedReferences: StoredFileReference[] = [];

    for (const file of files) {
      if (file.type === "pdf" && file.pdfPages && file.pdfPages.length > 0) {
        // Upload PDF pages
        const ref = await uploadPDFPages(
          user.id,
          conversationId,
          file.name,
          file.pdfPages
        );
        storedReferences.push(ref);
      } else {
        // Upload single image
        const ref = await uploadFile(user.id, conversationId, {
          name: file.name,
          type: file.type,
          data: file.dataUrl,
        });
        storedReferences.push(ref);
      }
    }

    // Update conversation with file references
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        // Cast to JSON-compatible type for Prisma
        imagesIncluded: JSON.parse(JSON.stringify(storedReferences)),
      },
    });

    console.log(`[Attachments] Saved ${storedReferences.length} file references`);

    return NextResponse.json({
      success: true,
      files: storedReferences,
    });
  } catch (error) {
    console.error("[Attachments] Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload files" },
      { status: 500 }
    );
  }
}

// GET - Retrieve file URLs for a conversation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify user owns this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: user.id,
      },
      select: {
        imagesIncluded: true,
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const storedFiles = conversation.imagesIncluded as StoredFileReference[] | null;

    if (!storedFiles || storedFiles.length === 0) {
      return NextResponse.json({ files: [] });
    }

    // Generate signed URLs for each file
    const filesWithUrls = await Promise.all(
      storedFiles.map(async (file) => {
        if (file.type === "pdf" && file.pageCount) {
          // Get URLs for all PDF pages
          const pageUrls = await getPDFPageUrls(file.storagePath, file.pageCount);
          return {
            name: file.name,
            type: file.type,
            pageCount: file.pageCount,
            pageUrls,
          };
        } else {
          // Get URL for single image
          const url = await getFileUrl(file.storagePath);
          return {
            name: file.name,
            type: file.type,
            url,
          };
        }
      })
    );

    return NextResponse.json({ files: filesWithUrls });
  } catch (error) {
    console.error("[Attachments] Get error:", error);
    return NextResponse.json(
      { error: "Failed to get files" },
      { status: 500 }
    );
  }
}
