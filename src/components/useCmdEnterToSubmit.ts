import { useEffect } from "react";

/**
 * Submit a modal form on Cmd+Enter (macOS) / Ctrl+Enter (everywhere else).
 *
 * Only attaches the global keydown listener while `enabled` is true, so
 * callers can pass an open/closed flag (often combined with form-validity
 * state) and this hook becomes a no-op when the modal is closed or the
 * submit button would be disabled.
 *
 * Skips while an IME composition is active so users typing in CJK
 * languages don't accidentally submit by pressing Enter to confirm a
 * candidate.
 */
export function useCmdEnterToSubmit(handler: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler, enabled]);
}
