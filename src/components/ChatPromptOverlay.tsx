"use client";

import { useEffect, useRef, useState } from "react";
import { useCmdEnterToSubmit } from "./useCmdEnterToSubmit";

/**
 * Ask for the question before opening the chat.
 *
 * "Chat About This" used to open a tab with the context primed and
 * nothing said, leaving the founder to re-orient in a new window and
 * type there. Most of the time they already knew what they wanted to
 * ask at the moment they clicked. Asking here means the new tab opens
 * with the answer already coming.
 *
 * Skip is deliberately kept and sits right next to Send, because the
 * old behaviour is still the right one when the question hasn't formed
 * yet — the tab opens with the context loaded and waits.
 */

export interface ChatPromptOverlayProps {
  open: boolean;
  /** What the chat will be about — shown so the modal explains itself. */
  subject: string;
  busy?: boolean;
  onSubmit: (prompt: string) => void;
  /** Open the chat with context loaded but nothing asked. */
  onSkip: () => void;
  onClose: () => void;
}

export default function ChatPromptOverlay({
  open,
  subject,
  busy = false,
  onSubmit,
  onSkip,
  onClose,
}: ChatPromptOverlayProps) {
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setPrompt("");
      // Focus after paint, or the autofocus lands before the element is
      // in the DOM and the founder types into nothing.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = () => {
    const p = prompt.trim();
    if (!p || busy) return;
    onSubmit(p);
  };

  // Cmd/Ctrl+Enter as well as plain Enter, since this sits in a
  // textarea where some people expect the modifier.
  useCmdEnterToSubmit(submit, open && !!prompt.trim() && !busy);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            What do you want to ask?
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate" title={subject}>
            Mikey will have {subject} in front of it.
          </p>
        </div>

        <div className="p-5">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a newline — the
              // convention every chat box in the app already uses.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                if (!busy) onClose();
              }
            }}
            rows={4}
            disabled={busy}
            placeholder="e.g. What did we decide about pricing, and what's still open?"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:border-purple-500 focus:ring-0 resize-none disabled:opacity-60"
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              Opens in a new tab
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onSkip}
                disabled={busy}
                title="Open the chat with this loaded, and ask there instead"
                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
              >
                Skip
              </button>
              <button
                onClick={submit}
                disabled={busy || !prompt.trim()}
                aria-label="Send"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 disabled:opacity-40"
              >
                {busy ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
