"use client";

import { useState, useRef, useLayoutEffect } from "react";

interface TruncatedUserMessageProps {
  content: string;
  maxLines?: number;
}

export function TruncatedUserMessage({ content, maxLines = 20 }: TruncatedUserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncatable, setIsTruncatable] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);

  // Approximate line height for text-[17px] with normal leading
  const LINE_HEIGHT = 26;
  const maxHeight = maxLines * LINE_HEIGHT;

  useLayoutEffect(() => {
    if (contentRef.current) {
      setIsTruncatable(contentRef.current.scrollHeight > maxHeight + LINE_HEIGHT);
    }
  }, [content, maxHeight]);

  const showTruncated = isTruncatable && !isExpanded;

  return (
    <div>
      <div className={showTruncated ? "relative" : undefined}>
        <p
          ref={contentRef}
          className={`whitespace-pre-wrap text-gray-900 dark:text-gray-100 text-[17px]${showTruncated ? " overflow-hidden" : ""}`}
          style={showTruncated ? { maxHeight: `${maxHeight}px` } : undefined}
        >
          {content}
        </p>
        {showTruncated && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 dark:from-gray-800 to-transparent pointer-events-none" />
        )}
      </div>
      {showTruncated && (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          Show more
        </button>
      )}
      {isTruncatable && isExpanded && (
        <button
          onClick={() => setIsExpanded(false)}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          Show less
        </button>
      )}
    </div>
  );
}
