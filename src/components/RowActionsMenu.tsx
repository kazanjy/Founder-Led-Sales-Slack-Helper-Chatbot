"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
 * Compact kebab (⋯) trigger with a click-anchored popover menu. The
 * menu renders into a portal at <body> so it can escape ancestor
 * overflow:hidden / clip / rounded-corner boxes. Position is anchored
 * to the trigger via getBoundingClientRect on each open and updated
 * on window scroll/resize while open.
 *
 * Click anywhere outside or press Esc to close. Each action's
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
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const MENU_WIDTH = 176; // matches w-44 in Tailwind
  const measure = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Right-align the menu under the trigger, but clamp to viewport.
    const right = rect.right;
    const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, right - MENU_WIDTH));
    setCoords({ left, top: rect.bottom + 4 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: coords.left, top: coords.top, width: MENU_WIDTH }}
      className="z-[1000] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 text-sm"
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
  );

  return (
    <>
      <button
        ref={triggerRef}
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
      {mounted && open && createPortal(menu, document.body)}
    </>
  );
}
