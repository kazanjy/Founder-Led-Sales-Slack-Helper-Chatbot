"use client";

import { useState, useMemo } from "react";

interface TruncatedUserMessageProps {
  content: string;
  maxLines?: number;
}

export function TruncatedUserMessage({ content, maxLines = 20 }: TruncatedUserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { shouldTruncate, truncatedContent, lineCount } = useMemo(() => {
    const lines = content.split("\n");
    const lineCount = lines.length;
    const shouldTruncate = lineCount > maxLines;
    const truncatedContent = shouldTruncate
      ? lines.slice(0, maxLines).join("\n")
      : content;
    return { shouldTruncate, truncatedContent, lineCount };
  }, [content, maxLines]);

  if (!shouldTruncate || isExpanded) {
    return (
      <div>
        <p className="whitespace-pre-wrap text-gray-900 text-[17px]">{content}</p>
        {shouldTruncate && isExpanded && (
          <button
            onClick={() => setIsExpanded(false)}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <p className="whitespace-pre-wrap text-gray-900 text-[17px]">{truncatedContent}</p>
        {/* Gradient fade effect */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent pointer-events-none" />
      </div>
      <button
        onClick={() => setIsExpanded(true)}
        className="mt-1 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
      >
        <span>Show more</span>
        <span className="text-gray-400 text-xs">({lineCount - maxLines} more lines)</span>
      </button>
    </div>
  );
}
