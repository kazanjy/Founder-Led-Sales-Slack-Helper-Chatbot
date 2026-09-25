"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Attendee {
  name?: string | null;
  email?: string | null;
}

interface Props {
  title?: string;
  subheader?: string;
  attendees: Attendee[];
  children: ReactNode;
}

/**
 * Wraps `children` in a hover-triggered popover that's rendered via
 * a portal at the document root, so it escapes any ancestor with
 * overflow:hidden / auto / scroll (e.g. a max-h list with internal
 * scroll). Position is computed from the trigger's bounding rect on
 * mouseenter and recomputed on window scroll/resize while open.
 *
 * Pops up beneath the trigger by default; flips above when there
 * isn't enough room below.
 */
export function AttendeePopover({ title, subheader, attendees, children }: Props) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; placeAbove: boolean }>(
    { left: 0, top: 0, placeAbove: false }
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const measure = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estimatedHeight = 12 + 22 + 18 + attendees.length * 32; // padding + title + subheader + rows
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < estimatedHeight + 16 && rect.top > estimatedHeight + 16;
    setCoords({
      left: rect.left,
      top: placeAbove ? rect.top - 4 : rect.bottom + 4,
      placeAbove,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleEnter = () => {
    measure();
    setOpen(true);
  };
  const handleLeave = () => setOpen(false);

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {mounted && open && attendees.length > 0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              transform: coords.placeAbove ? "translateY(-100%)" : undefined,
              pointerEvents: "none",
              zIndex: 1000,
            }}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 min-w-[14rem] max-w-[20rem]"
          >
            {title && (
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{title}</div>
            )}
            {subheader && (
              <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                {subheader}
              </div>
            )}
            <ul className="space-y-0.5">
              {attendees.map((a, idx) => (
                <li key={`${a.email || a.name || idx}`} className="text-xs">
                  {a.name && <div className="text-gray-800 dark:text-gray-100">{a.name}</div>}
                  {a.email && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all">{a.email}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
