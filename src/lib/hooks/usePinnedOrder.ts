"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Stable-order projection while the user is interacting with a row.
 *
 * Pattern: when the user clicks inside a card, the card's underlying
 * sort key (priority, stage, status, etc.) often changes — which
 * yanks the card out from under the mouse on the next render. This
 * hook snapshots the current rendered order when an interaction
 * begins and keeps the snapshot in place until the user clicks
 * outside the active card.
 *
 * Usage:
 *   const { ordered, pin, isPinned } = usePinnedOrder(rows, (r) => r.id);
 *   // Render `ordered` instead of the raw `rows`.
 *   // On each card, mark it with the pin attribute and call pin on
 *   // mousedown:
 *   <div
 *     data-pinned-id={row.id}
 *     onMouseDown={() => pin(row.id)}
 *   >...</div>
 *
 * Anything that didn't exist in the pinned snapshot but is in the
 * current data appends at the end so newly-created items still
 * surface; anything that left the data is silently dropped.
 */
export function usePinnedOrder<T>(
  items: T[],
  getId: (item: T) => string,
  options?: { pinAttribute?: string }
) {
  const pinAttr = options?.pinAttribute || "data-pinned-id";
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [pinnedOrder, setPinnedOrder] = useState<string[] | null>(null);

  // Keep a ref to the most recently rendered order so pin() can
  // snapshot from the *currently displayed* order (not the natural
  // sort) — that way, jumping from one pinned card to another
  // preserves the first card's frozen position.
  const lastRenderedOrderRef = useRef<string[]>([]);

  const ordered = useMemo(() => {
    if (!pinnedOrder) {
      lastRenderedOrderRef.current = items.map(getId);
      return items;
    }
    const byId = new Map(items.map((t) => [getId(t), t]));
    const out: T[] = [];
    const seen = new Set<string>();
    for (const id of pinnedOrder) {
      const t = byId.get(id);
      if (t) {
        out.push(t);
        seen.add(id);
      }
    }
    for (const t of items) {
      if (!seen.has(getId(t))) out.push(t);
    }
    lastRenderedOrderRef.current = out.map(getId);
    return out;
  }, [items, pinnedOrder, getId]);

  // Clear the pin when the user clicks anywhere outside the currently
  // pinned card. Uses a document mousedown listener with a closest()
  // lookup against the pin attribute so any nested control inside the
  // card stays "inside" for the purpose of this check.
  useEffect(() => {
    if (!pinnedId) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(`[${pinAttr}="${pinnedId}"]`)) return;
      setPinnedId(null);
      setPinnedOrder(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pinnedId, pinAttr]);

  const pin = (id: string) => {
    if (pinnedId === id) return;
    setPinnedOrder(
      lastRenderedOrderRef.current.length ? lastRenderedOrderRef.current : items.map(getId)
    );
    setPinnedId(id);
  };

  return { ordered, pin, isPinned: pinnedId !== null };
}
