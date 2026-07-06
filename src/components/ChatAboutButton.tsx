"use client";

import { useState } from "react";

interface ChatAboutButtonProps {
  /** Title for the new conversation */
  title: string;
  /** Function that returns the full context string to send to chat */
  getContext: () => string | Promise<string>;
  /** Optional custom label */
  label?: string;
  /** Render in a smaller, denser style (e.g. inside a sticky header) */
  compact?: boolean;
  /**
   * Conversation mode for the new chat. "CHATBASE" (default) routes
   * through the RAG path with a 7,500-char/message ceiling.
   * "DIRECT" sends straight to gpt-5.5 — use when the seeded
   * context is bigger than the Chatbase ceiling or when you need
   * full-fidelity reasoning over a large blob (transcripts, deal
   * history, coaching session content).
   */
  mode?: "CHATBASE" | "DIRECT";
  /**
   * When true, the artifact is loaded into the conversation as
   * context but NO assistant reply is generated — the chat opens
   * with the context primed and the input focused so the user can
   * ask their own question first. Use for plain "Chat about X"
   * entry points where auto-answering a question the user never
   * asked is surprising.
   *
   * When false (default), the context is auto-sent and the
   * assistant responds immediately — use for directive-style seeds
   * (e.g. "Synthesize Takeaways", where the context itself contains
   * the instruction to act on).
   */
  primeOnly?: boolean;
}

export function ChatAboutButton({ title, getContext, label = "Chat About This", compact = false, mode = "CHATBASE", primeOnly = false }: ChatAboutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const context = await getContext();
      // Two behaviors:
      //
      // primeOnly=true → autoSend:false. The server pre-seeds the
      //   context as a USER message with NO assistant reply. We open
      //   the chat plainly (no ?autoSend), so the user lands in a
      //   conversation with the context already loaded and can type
      //   their own question. Their next message becomes a normal
      //   turn with the context available in history.
      //
      // primeOnly=false → autoSend:true creates an EMPTY conversation;
      //   we stash the context in sessionStorage and open with
      //   ?autoSend=true, which fires sendMessage(context) on mount —
      //   creating the USER message AND driving the assistant reply.
      //   (Modern browsers copy sessionStorage to the new tab when
      //   window.open is called without noopener.)
      const res = await fetch("/api/conversations/from-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, context, mode, autoSend: !primeOnly }),
      });
      const data = await res.json();
      if (data.conversationId) {
        if (primeOnly) {
          window.open(`/chat/${data.conversationId}`, "_blank");
        } else {
          sessionStorage.setItem(`autoSend-${data.conversationId}`, context);
          window.open(`/chat/${data.conversationId}?autoSend=true`, "_blank");
        }
      }
    } catch (error) {
      console.error("Failed to create chat:", error);
    } finally {
      setLoading(false);
    }
  };

  const sizing = compact
    ? "gap-1.5 px-2.5 py-1 text-xs"
    : "gap-2 px-4 py-2.5 text-sm";
  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-sm hover:shadow-md disabled:opacity-50 ${sizing}`}
    >
      {loading ? (
        <svg className={`animate-spin ${iconSize}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )}
      {label}
    </button>
  );
}
