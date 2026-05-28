"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface RowAction {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  /** Action groups; each group is rendered with a divider above. */
  groups: RowAction[][];
  /** Optional aria-label for the trigger. */
  triggerLabel?: string;
  /** Tailwind classes for the trigger button. */
  triggerClass?: string;
  /** Tailwind size class for the kebab svg. */
  iconClass?: string;
}

/**
 * Compact kebab (⋯) trigger with a click-anchored popover menu. Used
 * to replace per-row hover-only chevron strips on goals/tasks/
 * subtasks so the title field can claim the row width and the
 * affordance survives on touch.
 *
 * Click anywhere outside (or press Esc) to close. Each action's
 * onClick auto-closes the menu — callers don't need to track open
 * state themselves.
 */
export function RowActionsMenu({
  groups,
  triggerLabel = "Row actions",
  triggerClass = "p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded transition-colors",
  iconClass = "w-4 h-4",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClass}
      >
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {groups.flatMap((group, gi) => {
            const items = group
              .filter((a) => a)
              .map((action) => (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    if (action.disabled) return;
                    action.onClick();
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    action.disabled
                      ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                      : action.danger
                        ? "text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {action.icon && (
                    <span className="w-3.5 h-3.5 flex-shrink-0 inline-flex items-center justify-center text-current">
                      {action.icon}
                    </span>
                  )}
                  <span className="flex-1">{action.label}</span>
                </button>
              ));
            return [
              gi > 0 && (
                <div key={`sep-${gi}`} className="my-1 border-t border-gray-100 dark:border-gray-700" />
              ),
              ...items,
            ];
          })}
        </div>
      )}
    </div>
  );
}
