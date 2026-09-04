"use client";

import { useState, useRef, useLayoutEffect } from "react";

interface TruncatedUserMessageProps {
  content: string;
  maxLines?: number;
  /** Pixel line-height matching the styled text. Defaults to 26 for the
   *  text-[17px] body used on the main chat page; pass 20 for text-sm
   *  bubbles like the Deal Chat panel. */
  lineHeight?: number;
  /** Tailwind classes applied to the rendered <p>. Overrides the
   *  default text-[17px] / gray-900 styling used on the main chat. */
  className?: string;
  /** Tailwind `from-*` color for the fade-out gradient overlay — set
   *  to whatever the bubble background is so the truncation gradient
   *  blends instead of stacking over a contrasting color. */
  fadeFromClass?: string;
  /** Tailwind classes for the Show more / Show less button, so the
   *  button reads correctly on dark bubble backgrounds. */
  buttonClassName?: string;
}

const DEFAULT_TEXT_CLASS =
  "whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100 text-[17px]";
const DEFAULT_FADE_CLASS = "from-gray-50 dark:from-gray-800";
const DEFAULT_BUTTON_CLASS =
  "text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium";

export function TruncatedUserMessage({
  content,
  maxLines = 20,
  lineHeight = 26,
  className,
  fadeFromClass,
  buttonClassName,
}: TruncatedUserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncatable, setIsTruncatable] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);

  const maxHeight = maxLines * lineHeight;
  const textClass = className ?? DEFAULT_TEXT_CLASS;
  const fadeClass = fadeFromClass ?? DEFAULT_FADE_CLASS;
  const btnClass = buttonClassName ?? DEFAULT_BUTTON_CLASS;

  useLayoutEffect(() => {
    if (contentRef.current) {
      setIsTruncatable(contentRef.current.scrollHeight > maxHeight + lineHeight);
    }
  }, [content, maxHeight, lineHeight]);

  const showTruncated = isTruncatable && !isExpanded;

  return (
    <div>
      <div className={showTruncated ? "relative" : undefined}>
        <p
          ref={contentRef}
          className={`${textClass}${showTruncated ? " overflow-hidden" : ""}`}
          style={showTruncated ? { maxHeight: `${maxHeight}px` } : undefined}
        >
          {content}
        </p>
        {showTruncated && (
          <div className={`absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t ${fadeClass} to-transparent pointer-events-none`} />
        )}
      </div>
      {showTruncated && (
        <button
          onClick={() => setIsExpanded(true)}
          className={`mt-1 ${btnClass}`}
        >
          Show more
        </button>
      )}
      {isTruncatable && isExpanded && (
        <button
          onClick={() => setIsExpanded(false)}
          className={`mt-2 ${btnClass}`}
        >
          Show less
        </button>
      )}
    </div>
  );
}
