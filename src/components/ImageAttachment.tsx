"use client";

import { useRef, useEffect, useMemo } from "react";

interface FileAttachmentProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
}

// Check if file is an image
function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

// Check if file is a PDF
function isPDFFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// Check if file is supported (image or PDF)
function isSupportedFile(file: File): boolean {
  return isImageFile(file) || isPDFFile(file);
}

export function FileAttachmentButton({
  onFilesChange,
  disabled = false,
  currentCount = 0,
  maxFiles = 4,
}: {
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  currentCount?: number;
  maxFiles?: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Filter to only supported files (images and PDFs)
    const supportedFiles = files.filter(isSupportedFile);

    // Limit to remaining slots
    const remaining = maxFiles - currentCount;
    const filesToAdd = supportedFiles.slice(0, remaining);

    if (filesToAdd.length > 0) {
      onFilesChange(filesToAdd);
    }

    // Clear input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isMaxReached = currentCount >= maxFiles;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isMaxReached}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isMaxReached}
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={isMaxReached ? `Maximum ${maxFiles} files` : "Attach image or PDF"}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>
    </>
  );
}

export function FilePreviewChips({
  files,
  onRemove,
  onPreview,
  processing = false,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onPreview?: (index: number) => void;
  processing?: boolean;
}) {
  // Generate preview URLs for image files
  const previews = useMemo(() => {
    return files.map((file) => ({
      file,
      url: isImageFile(file) ? URL.createObjectURL(file) : null,
      isPDF: isPDFFile(file),
    }));
  }, [files]);

  // Cleanup URLs when files change
  useEffect(() => {
    return () => {
      previews.forEach((preview) => {
        if (preview.url) URL.revokeObjectURL(preview.url);
      });
    };
  }, [previews]);

  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {previews.map((preview, index) => (
        <div
          key={`${preview.file.name}-${index}`}
          className="relative group"
        >
          {preview.isPDF ? (
            // PDF preview - show icon and filename
            <div
              className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 ${processing ? "opacity-50" : "cursor-pointer hover:border-gray-300 hover:bg-gray-100"}`}
              onClick={() => !processing && onPreview?.(index)}
            >
              <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zm-3 9.5c0 .83-.67 1.5-1.5 1.5H7v2H5.5v-6H8.5c.83 0 1.5.67 1.5 1.5v1zm5 .5c0 1.1-.9 2-2 2h-1v2H10.5v-6h2.5c1.1 0 2 .9 2 2v1zm5-1h-1.5v1H18v1h-1.5v2H15v-6h3.5v1.5z"/>
              </svg>
              <span className="text-sm text-gray-700 max-w-[120px] truncate">{preview.file.name}</span>
              {processing && (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          ) : (
            // Image preview - show thumbnail
            <div
              className={`relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 ${processing ? "" : "cursor-pointer hover:border-gray-300"}`}
              onClick={() => !processing && onPreview?.(index)}
            >
              <img
                src={preview.url || ""}
                alt={preview.file.name}
                className={`w-full h-full object-cover ${processing ? "opacity-50" : ""}`}
              />
              {processing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
          {!processing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
              }}
              className="absolute -top-1 -right-1 w-5 h-5 bg-gray-700 hover:bg-gray-800 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove file"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// Legacy exports for backward compatibility
export const ImageAttachmentButton = FileAttachmentButton;
export const ImagePreviewChips = FilePreviewChips;

export function ImageAttachment({
  images,
  onImagesChange,
  disabled = false,
  maxImages = 4,
}: {
  images: File[];
  onImagesChange: (images: File[]) => void;
  disabled?: boolean;
  maxImages?: number;
}) {
  const handleRemove = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  const handleAdd = (newImages: File[]) => {
    onImagesChange([...images, ...newImages]);
  };

  return (
    <div className="flex items-center gap-2">
      <FilePreviewChips files={images} onRemove={handleRemove} />
      <FileAttachmentButton
        onFilesChange={handleAdd}
        disabled={disabled}
        currentCount={images.length}
        maxFiles={maxImages}
      />
    </div>
  );
}

// AttachedFile interface for stored image/PDF data
export interface AttachedFile {
  name: string;
  type: "image" | "pdf";
  dataUrl: string; // base64 data URL for images, first page for PDFs
  pdfPages?: string[]; // All page data URLs for PDFs
}

// Read-only chips showing attached images/PDFs (after sending) - clickable for lightbox
export function ImageChipsReadOnly({
  files,
  onPreview,
}: {
  files: AttachedFile[];
  onPreview?: (index: number) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, index) => {
        const isPDF = file.type === "pdf";
        return (
          <div
            key={`${file.name}-${index}`}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-600 ${onPreview ? "cursor-pointer hover:border-gray-300 hover:bg-gray-100" : ""}`}
            onClick={() => onPreview?.(index)}
          >
            {isPDF ? (
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            <span className="max-w-[150px] truncate">{file.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// Export helper functions
export { isImageFile, isPDFFile, isSupportedFile };
