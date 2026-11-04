"use client";

import { useEffect, useCallback } from "react";

export interface LightboxImage {
  url: string; // base64 data URL or blob URL
  name: string;
  type: "image" | "pdf-page";
  pageNumber?: number; // for PDF pages
}

interface LightboxProps {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDownload?: () => void;
}

export function Lightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  onDownload,
}: LightboxProps) {
  const currentImage = images[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && hasNext) {
        onNavigate(currentIndex + 1);
      }
    },
    [onClose, onNavigate, currentIndex, hasPrev, hasNext]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden"; // Prevent background scroll

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  if (!currentImage) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
        title="Close (Esc)"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Download button */}
      {onDownload && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          className="absolute top-4 right-16 p-2 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
          title="Previous (←)"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-colors z-10"
          title="Next (→)"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Image container */}
      <div
        className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentImage.url}
          alt={currentImage.name}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
      </div>

      {/* Image info bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 rounded-full text-white text-sm flex items-center gap-3">
        <span className="max-w-[300px] truncate">{currentImage.name}</span>
        {images.length > 1 && (
          <span className="text-white/60">
            {currentIndex + 1} / {images.length}
          </span>
        )}
        {currentImage.pageNumber && (
          <span className="text-white/60">Page {currentImage.pageNumber}</span>
        )}
      </div>
    </div>
  );
}
