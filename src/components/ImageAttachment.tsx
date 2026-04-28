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

// Check if file is a CSV
function isCSVFile(file: File): boolean {
  return file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
}

// Check if file is supported (image, PDF, or CSV)
function isSupportedFile(file: File): boolean {
  return isImageFile(file) || isPDFFile(file) || isCSVFile(file);
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const imageFiles = files.filter(isImageFile);
    const remaining = maxFiles - currentCount;
    const filesToAdd = imageFiles.slice(0, remaining);
    if (filesToAdd.length > 0) onFilesChange(filesToAdd);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handlePDFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const pdfFiles = files.filter(isPDFFile);
    const remaining = maxFiles - currentCount;
    const filesToAdd = pdfFiles.slice(0, remaining);
    if (filesToAdd.length > 0) onFilesChange(filesToAdd);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  const handleCSVChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const csvFiles = files.filter(isCSVFile);
    const remaining = maxFiles - currentCount;
    const filesToAdd = csvFiles.slice(0, remaining);
    if (filesToAdd.length > 0) onFilesChange(filesToAdd);
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const isMaxReached = currentCount >= maxFiles;
  const isDisabled = disabled || isMaxReached;

  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageChange}
        disabled={isDisabled}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handlePDFChange}
        disabled={isDisabled}
      />
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="hidden"
        onChange={handleCSVChange}
        disabled={isDisabled}
      />
      {/* Image upload button */}
      <button
        type="button"
        onClick={() => imageInputRef.current?.click()}
        disabled={isDisabled}
        className={`p-2 rounded-lg transition-colors inline-flex items-center justify-center ${
          isDisabled
            ? "text-gray-400 opacity-50 cursor-not-allowed"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
        }`}
        title={isMaxReached ? `Maximum ${maxFiles} files` : "Attach image"}
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
      {/* PDF upload button */}
      <button
        type="button"
        onClick={() => pdfInputRef.current?.click()}
        disabled={isDisabled}
        className={`p-2 rounded-lg transition-colors inline-flex items-center justify-center ${
          isDisabled
            ? "text-gray-400 opacity-50 cursor-not-allowed"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
        }`}
        title={isMaxReached ? `Maximum ${maxFiles} files` : "Attach PDF"}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          {/* Document body */}
          <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill="#E53935"/>
          {/* Folded corner */}
          <path d="M14 2V8H20L14 2Z" fill="#FFCDD2"/>
          {/* PDF text */}
          <text x="12" y="17" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">PDF</text>
        </svg>
      </button>
      {/* CSV upload button */}
      <button
        type="button"
        onClick={() => csvInputRef.current?.click()}
        disabled={isDisabled}
        className={`p-2 rounded-lg transition-colors inline-flex items-center justify-center ${
          isDisabled
            ? "text-gray-400 opacity-50 cursor-not-allowed"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
        }`}
        title={isMaxReached ? `Maximum ${maxFiles} files` : "Attach CSV"}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill="#2E7D32"/>
          <path d="M14 2V8H20L14 2Z" fill="#C8E6C9"/>
          <text x="12" y="17" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">CSV</text>
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
      isCSV: isCSVFile(file),
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
          {preview.isPDF || preview.isCSV ? (
            // PDF/CSV preview - show icon and filename
            <div
              className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 ${processing ? "opacity-50" : "cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
              onClick={() => !processing && onPreview?.(index)}
            >
              <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill={preview.isCSV ? "#2E7D32" : "#E53935"}/>
                <path d="M14 2V8H20L14 2Z" fill={preview.isCSV ? "#C8E6C9" : "#FFCDD2"}/>
                <text x="12" y="17" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">{preview.isCSV ? "CSV" : "PDF"}</text>
              </svg>
              <span className="text-sm text-gray-700 dark:text-gray-200 max-w-[120px] truncate">{preview.file.name}</span>
              {processing && (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          ) : (
            // Image preview - show thumbnail
            <div
              className={`relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 ${processing ? "" : "cursor-pointer hover:border-gray-300 dark:hover:border-gray-600"}`}
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

// AttachedFile interface for stored image/PDF/CSV data
export interface AttachedFile {
  name: string;
  type: "image" | "pdf" | "csv";
  dataUrl: string; // base64 data URL for images, first page for PDFs, empty for CSVs
  pdfPages?: string[]; // All page data URLs for PDFs
  csvText?: string; // Parsed text content for CSVs
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
        const isCSV = file.type === "csv";
        return (
          <div
            key={`${file.name}-${index}`}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 text-sm text-gray-600 dark:text-gray-300 ${onPreview ? "cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" : ""}`}
            onClick={() => onPreview?.(index)}
          >
            {isPDF || isCSV ? (
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill={isCSV ? "#2E7D32" : "#E53935"}/>
                <path d="M14 2V8H20L14 2Z" fill={isCSV ? "#C8E6C9" : "#FFCDD2"}/>
                <text x="12" y="17" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">{isCSV ? "CSV" : "PDF"}</text>
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
export { isImageFile, isPDFFile, isCSVFile, isSupportedFile };
