import { ReactNode } from "react";

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

export function Linkify({ children, className = "text-blue-600 hover:text-blue-800 underline break-all" }: { children: string; className?: string }): ReactNode {
  const parts = children.split(URL_REGEX);
  if (parts.length === 1) return children;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={className} onClick={(e) => e.stopPropagation()}>{part}</a>
    ) : part
  );
}
