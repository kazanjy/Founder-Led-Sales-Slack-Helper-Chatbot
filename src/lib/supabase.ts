import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client for storage operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Bucket name for conversation attachments
export const ATTACHMENTS_BUCKET = "conversation-attachments";

// Interface for stored file reference
export interface StoredFileReference {
  name: string;
  type: "image" | "pdf";
  storagePath: string;
  pageCount?: number; // For PDFs
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  userId: string,
  conversationId: string,
  file: {
    name: string;
    type: "image" | "pdf";
    data: string; // base64 data URL
  }
): Promise<StoredFileReference> {
  // Convert base64 to buffer (Node.js compatible)
  const base64Data = file.data.split(",")[1];
  const mimeType = file.data.split(";")[0].split(":")[1];
  const buffer = Buffer.from(base64Data, "base64");

  // Create storage path: userId/conversationId/timestamp-filename
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storagePath = `${userId}/${conversationId}/${timestamp}-${safeName}`;

  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error("[Storage] Upload error:", error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return {
    name: file.name,
    type: file.type,
    storagePath,
  };
}

/**
 * Upload PDF pages to Supabase Storage
 */
export async function uploadPDFPages(
  userId: string,
  conversationId: string,
  pdfName: string,
  pages: string[] // Array of base64 data URLs
): Promise<StoredFileReference> {
  const timestamp = Date.now();
  const safeName = pdfName.replace(/[^a-zA-Z0-9.-]/g, "_").replace(".pdf", "");
  const baseStoragePath = `${userId}/${conversationId}/${timestamp}-${safeName}`;

  // Upload each page
  for (let i = 0; i < pages.length; i++) {
    const pageData = pages[i];
    const base64Data = pageData.split(",")[1];
    const mimeType = pageData.split(";")[0].split(":")[1] || "image/jpeg";

    // Use Buffer for Node.js compatibility
    const buffer = Buffer.from(base64Data, "base64");

    const pagePath = `${baseStoragePath}/page-${String(i + 1).padStart(3, "0")}.jpg`;

    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(pagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error(`[Storage] Failed to upload PDF page ${i + 1}:`, error);
      throw new Error(`Failed to upload PDF page ${i + 1}: ${error.message}`);
    }
  }

  return {
    name: pdfName,
    type: "pdf",
    storagePath: baseStoragePath,
    pageCount: pages.length,
  };
}

/**
 * Get a signed URL for a file (valid for 1 hour)
 */
export async function getFileUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour expiry

  if (error) {
    console.error("[Storage] Signed URL error:", error);
    return null;
  }

  return data.signedUrl;
}

/**
 * Get signed URLs for all pages of a PDF
 */
export async function getPDFPageUrls(
  storagePath: string,
  pageCount: number
): Promise<string[]> {
  const urls: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const pagePath = `${storagePath}/page-${String(i).padStart(3, "0")}.jpg`;
    const url = await getFileUrl(pagePath);
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Delete all files for a conversation (for cleanup)
 */
export async function deleteConversationFiles(
  userId: string,
  conversationId: string
): Promise<void> {
  const folderPath = `${userId}/${conversationId}`;

  // List all files in the folder
  const { data: files, error: listError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .list(folderPath, { limit: 1000 });

  if (listError) {
    console.error("[Storage] List error:", listError);
    return;
  }

  if (!files || files.length === 0) return;

  // Delete all files
  const filePaths = files.map((f) => `${folderPath}/${f.name}`);
  const { error: deleteError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(filePaths);

  if (deleteError) {
    console.error("[Storage] Delete error:", deleteError);
  }
}
