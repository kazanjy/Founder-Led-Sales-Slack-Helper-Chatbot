"use client";

import { useRef, useEffect, useMemo } from "react";

interface ImageAttachmentProps {
  images: File[];
  onImagesChange: (images: File[]) => void;
  disabled?: boolean;
  maxImages?: number;
}

interface ImagePreview {
  file: File;
  url: string;
}

export function ImageAttachmentButton({
  onImagesChange,
  disabled = false,
  currentCount = 0,
  maxImages = 4,
}: {
  onImagesChange: (images: File[]) => void;
  disabled?: boolean;
  currentCount?: number;
  maxImages?: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Filter to only image files
    const imageFiles = files.filter((file) =>
      file.type.startsWith("image/")
    );

    // Limit to remaining slots
    const remaining = maxImages - currentCount;
    const filesToAdd = imageFiles.slice(0, remaining);

    if (filesToAdd.length > 0) {
      onImagesChange(filesToAdd);
    }

    // Clear input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isMaxReached = currentCount >= maxImages;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
        title={isMaxReached ? `Maximum ${maxImages} images` : "Attach image"}
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

export function ImagePreviewChips({
  images,
  onRemove,
  processing = false,
}: {
  images: File[];
  onRemove: (index: number) => void;
  processing?: boolean;
}) {
  // Generate preview URLs for images using useMemo to avoid recreation on each render
  const previews = useMemo(() => {
    return images.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
  }, [images]);

  // Cleanup URLs when images change
  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {previews.map((preview, index) => (
        <div
          key={`${preview.file.name}-${index}`}
          className="relative group"
        >
          <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <img
              src={preview.url}
              alt={preview.file.name}
              className={`w-full h-full object-cover ${processing ? "opacity-50" : ""}`}
            />
            {processing && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          {!processing && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute -top-1 -right-1 w-5 h-5 bg-gray-700 hover:bg-gray-800 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove image"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ImageAttachment({
  images,
  onImagesChange,
  disabled = false,
  maxImages = 4,
}: ImageAttachmentProps) {
  const handleRemove = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  const handleAdd = (newImages: File[]) => {
    onImagesChange([...images, ...newImages]);
  };

  return (
    <div className="flex items-center gap-2">
      <ImagePreviewChips images={images} onRemove={handleRemove} />
      <ImageAttachmentButton
        onImagesChange={handleAdd}
        disabled={disabled}
        currentCount={images.length}
        maxImages={maxImages}
      />
    </div>
  );
}
