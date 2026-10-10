"use client";

import { useEffect, useState } from "react";

interface Props {
  storageKey: string;
  widthClass?: string;
  children: React.ReactNode;
}

/**
 * Wraps a right-rail sidebar (Iterate panel + sibling widgets) with a
 * collapse toggle that the user can flip to give the main content
 * more horizontal room. Collapse state persists per page via
 * localStorage so reloads keep the layout the user chose.
 *
 * Pass the same DOM you used to render inside the
 * `<div className="hidden lg:block w-64 flex-shrink-0">` wrapper —
 * the component re-creates that wrapper itself.
 */
export function CollapsibleRightSidebar({
  storageKey,
  widthClass = "w-64",
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`sidebar-collapsed:${storageKey}`);
      if (raw === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`sidebar-collapsed:${storageKey}`, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Pre-hydration render matches the previous markup so SSR + first
  // paint don't shift the layout.
  if (!hydrated) {
    return <div className={`hidden lg:block ${widthClass} flex-shrink-0`}>{children}</div>;
  }

  if (collapsed) {
    return (
      <div className="hidden lg:block w-8 flex-shrink-0">
        <div className="sticky top-8">
          <button
            onClick={toggle}
            className="w-7 h-14 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 transition-colors"
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`hidden lg:block ${widthClass} flex-shrink-0 relative`}>
      <button
        onClick={toggle}
        className="absolute -left-3 top-2 z-10 w-6 h-6 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 transition-colors"
        title="Hide sidebar"
        aria-label="Hide sidebar"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {children}
    </div>
  );
}
