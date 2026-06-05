"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyMarkdownAsRichText } from "@/lib/clipboard";

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

export interface DealChatThread {
  conversationId: string;
  label: string;
  timestamp: string; // ISO
}

interface DealChatPanelProps {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  dealName: string;
  buildContext: (question: string) => string;
  conversationId: string | null;
  onConversationCreated: (id: string, firstQuestion: string) => void;
  // An auto-send request from the parent: when autoSendNonce changes to a
  // value we haven't processed, the panel sends autoSendQuestion as the next
  // message. Used by the entry-form "Ask Mikey about this" flow.
  autoSendQuestion?: string;
  autoSendNonce?: number;
  // All Deal Chat conversations for this deal, plus a selector callback.
  // When the user picks a different thread (or "+ New thread"), the parent
  // swaps conversationId in state.
  threads?: DealChatThread[];
  onSelectThread?: (conversationId: string | null) => void;
}

export default function DealChatPanel({
  open,
  onClose,
  onOpen,
  dealName,
  buildContext,
  conversationId,
  onConversationCreated,
  autoSendQuestion,
  autoSendNonce,
  threads,
  onSelectThread,
}: DealChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [width, setWidth] = useState<number>(420);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore the user's saved panel width on mount, clamped to the current
  // viewport so a narrow screen doesn't get a 1200px panel.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("dealChatPanelWidth");
    const parsed = saved ? parseInt(saved, 10) : NaN;
    const initial = Number.isFinite(parsed) ? parsed : 420;
    const max = Math.max(320, window.innerWidth - 80);
    setWidth(Math.min(Math.max(320, initial), max));
  }, []);

  // Track pointer while the user drags the left edge of the panel. Listeners
  // live on window so drags keep working when the pointer leaves the handle.
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      const next = window.innerWidth - e.clientX;
      const clamped = Math.min(Math.max(320, next), window.innerWidth - 80);
      setWidth(clamped);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Keep the ew-resize cursor + suppress text selection during the drag.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [isDragging]);

  // Persist width changes so the next mount restores the user's preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("dealChatPanelWidth", String(Math.round(width)));
  }, [width]);

  // Load prior messages when (re)opening with an existing conversation.
  useEffect(() => {
    if (!open) return;
    if (!conversationId) {
      setMessages([]);
      setHistoryLoaded(true);
      return;
    }
    if (historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // The /api/conversations/[id] route nests messages under
        // data.conversation.messages, not at the top level.
        const rawMessages = data.conversation?.messages || data.messages || [];
        const loaded: Message[] = rawMessages.map((m: { id: string; role: string; content: string; createdAt: string }) => ({
          id: m.id,
          role: m.role === "USER" ? "USER" : "ASSISTANT",
          content: m.content,
          createdAt: m.createdAt,
        }));
        setMessages(loaded);
        setHistoryLoaded(true);
      } catch {
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, conversationId, historyLoaded]);

  // Reset the loaded flag when the conversation id changes so a fresh load fires.
  useEffect(() => {
    setHistoryLoaded(false);
  }, [conversationId]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // When the user sends a new message, snap the just-added user bubble to
  // the top of the scroll area so the prompt stays visible while the
  // assistant's reply streams in below it. We deliberately don't follow the
  // bottom of the stream — that would scroll the user's own prompt off-screen.
  // Initial history loads (messages.length going 0 → N on mount) don't match
  // this, so they land at scroll-top naturally.
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (messages.length <= prev || prev === 0) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "USER") return;
    requestAnimationFrame(() => {
      const userEl = el.querySelector(`[data-msg-id="${CSS.escape(last.id)}"]`) as HTMLElement | null;
      if (userEl) el.scrollTop = Math.max(0, userEl.offsetTop - 8);
    });
  }, [messages]);

  // The first user message is the full deal-context blob (the backend saves
  // whatever we send to /messages/stream). Extract just the user's actual
  // prompt for display; leave other messages untouched.
  const displayContent = (m: Message, idx: number): string => {
    if (m.role !== "USER" || idx !== 0) return m.content;
    const match = m.content.match(/^My specific prompt is: "([\s\S]*?)"$/m);
    return match ? match[1] : m.content;
  };

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setInput("");

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // First turn bakes the deal context into the message; subsequent turns
    // rely on the conversation history already stored server-side.
    const isFirstTurn = messages.length === 0;
    const payload = isFirstTurn ? buildContext(trimmed) : trimmed;

    try {
      let convId = conversationId;
      if (!convId) {
        const createRes = await fetch("/api/conversations/from-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Deal: ${dealName}`, context: payload, autoSend: true }),
        });
        if (!createRes.ok) throw new Error("Failed to start conversation");
        const createData = await createRes.json();
        convId = createData.conversationId;
        if (!convId) throw new Error("No conversation id returned");
        onConversationCreated(convId, trimmed);
      }

      const res = await fetch(`/api/conversations/${convId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: payload }),
      });
      if (!res.ok || !res.body) throw new Error("Stream request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let messageId = "";
      let createdAt = "";
      setStreamingMessage("");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.text) {
              full += parsed.text;
              setStreamingMessage(full);
            } else if (parsed.messageId) {
              messageId = parsed.messageId;
              createdAt = parsed.createdAt;
            } else if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch {
            // non-JSON data line, skip
          }
        }
      }

      setStreamingMessage("");
      if (full) {
        setMessages((prev) => [
          ...prev,
          {
            id: messageId || `msg-${Date.now()}`,
            role: "ASSISTANT",
            content: full,
            createdAt: createdAt || new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.error("Deal chat send failed:", err);
      setStreamingMessage("");
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "ASSISTANT",
          content: "Something went wrong sending that message. Try again?",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [sending, messages.length, buildContext, conversationId, dealName, onConversationCreated]);

  // Auto-send a question the parent hands us (used by the entry-form
  // "Ask Mikey about this" flow). We key on a monotonically-increasing
  // nonce so the same question text can trigger another send later if the
  // parent decides to; we also wait until history has loaded so we don't
  // race with a hydration that might appear to make the conversation "new".
  const lastAutoSendNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    if (autoSendNonce === undefined || !autoSendQuestion) return;
    if (lastAutoSendNonceRef.current === autoSendNonce) return;
    if (!historyLoaded) return;
    if (sending) return;
    lastAutoSendNonceRef.current = autoSendNonce;
    sendMessage(autoSendQuestion);
  }, [open, autoSendNonce, autoSendQuestion, historyLoaded, sending, sendMessage]);

  // If the URL hash points at a specific message (#msg-<id>), scroll that
  // message into view once history has loaded. Lets a copied per-message
  // anchor link deep-link straight to the right reply.
  const scrolledToHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !historyLoaded) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (!hash.startsWith("#msg-")) return;
    if (scrolledToHashRef.current === hash) return;
    scrolledToHashRef.current = hash;
    const msgId = hash.slice(5);
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${msgId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [open, historyLoaded, messages.length]);

  // When closed, show a narrow rail pinned to the right edge as a persistent
  // entry point back into the panel. Clicking the rail opens the panel with
  // whatever conversation is currently in state.
  if (!open) {
    const hasMessages = messages.length > 0;
    return (
      <button
        type="button"
        onClick={onOpen}
        className="fixed right-0 top-1/3 z-30 flex flex-col items-center gap-3 px-3 py-5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 border-r-0 rounded-l-xl shadow-lg hover:bg-purple-50 hover:border-purple-200 transition-colors group/rail"
        aria-label="Open Deal Chat"
        title="Open Deal Chat"
      >
        <span className="text-3xl leading-none">🌊</span>
        <span
          className="text-[11px] font-semibold tracking-wider text-gray-600 dark:text-gray-300 group-hover/rail:text-purple-700 uppercase"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Deal Chat
        </span>
        {hasMessages && (
          <span className="text-xs font-semibold text-purple-700 bg-purple-100 rounded-full px-2 py-0.5 min-w-[24px] text-center">
            {messages.length}
          </span>
        )}
        <svg className="w-5 h-5 text-gray-400 group-hover/rail:text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    );
  }

  return (
    <>
      {/* Transparent backdrop — clicks anywhere outside the panel dismiss it.
          No dim so the deal timeline behind the panel stays visible. */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
    <div
      className="fixed inset-y-0 right-0 z-40 bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col"
      style={{ width: `${width}px`, maxWidth: "100vw" }}
    >
      {/* Drag handle on the left edge — drag to resize, double-click to reset. */}
      <div
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setIsDragging(true);
        }}
        onDoubleClick={() => setWidth(420)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize Deal Chat panel"
        className={`absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize z-10 transition-colors ${isDragging ? "bg-purple-400" : "hover:bg-purple-300"}`}
      />
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🌊</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">Deal Chat</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{dealName}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {conversationId && (
            <button
              type="button"
              onClick={() => {
                // Open the window synchronously so the click is still in
                // a user-gesture context (browsers block window.open
                // called after an await). Then flip the conversation to
                // DIRECT and navigate the placeholder. Forcing DIRECT
                // because popping a Deal Chat out signals deep work —
                // the user wants full context, not RAG-bounded Chatbase.
                const popup = window.open(
                  "about:blank",
                  `deal-chat-${conversationId}`,
                  "popup=1,width=560,height=820,noopener,noreferrer"
                );
                const targetUrl = `/chat/${conversationId}`;
                fetch(`/api/conversations/${conversationId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: "DIRECT" }),
                })
                  .catch((err) => {
                    console.error("[DealChatPanel] failed to flip mode before popout:", err);
                  })
                  .finally(() => {
                    if (popup && !popup.closed) {
                      popup.location.href = targetUrl;
                    } else {
                      // Popup blocked — fall back to opening in the
                      // current tab so the user still gets the chat.
                      window.location.href = targetUrl;
                    }
                  });
              }}
              className="text-gray-400 hover:text-purple-600 p-1"
              title="Pop this chat out into its own window (switches to Direct LLM)"
              aria-label="Pop chat out into a new window"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close chat panel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {threads && threads.length > 0 && onSelectThread && (
        <ThreadSwitcher
          threads={threads}
          activeConversationId={conversationId}
          onSelect={onSelectThread}
        />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streamingMessage && (
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <div>Ask Mikey anything about this deal. Mikey has the timeline, participants, latest analysis, and your sales narrative.</div>
            {!conversationId && threads && threads.length > 0 && (
              <div className="text-[11px] text-purple-700 dark:text-purple-300 font-medium">
                💬 {threads.length} previous {threads.length === 1 ? "thread" : "threads"} on this deal — switch above ↑
              </div>
            )}
          </div>
        )}
        {messages.map((m, idx) => {
          const wrapClass = m.role === "USER"
            ? "flex justify-end"
            : "flex flex-col items-start";
          const bubbleClass = m.role === "USER"
            ? "max-w-[85%] bg-purple-600 text-white rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap"
            : "max-w-[90%] bg-gray-100 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md px-3 py-2 text-sm prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1";
          return (
            <div
              key={m.id}
              data-msg-id={m.id}
              id={m.role === "ASSISTANT" ? `msg-${m.id}` : undefined}
              className={wrapClass}
            >
              <div className={bubbleClass}>
                {m.role === "USER" ? (
                  displayContent(m, idx)
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                )}
              </div>
              {m.role === "ASSISTANT" && (
                <AssistantMessageToolbar message={m} conversationId={conversationId} />
              )}
            </div>
          );
        })}
        {streamingMessage && (
          <div className="flex justify-start">
            <div className="max-w-[90%] bg-gray-100 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md px-3 py-2 text-sm prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>
                  ),
                }}
              >
                {streamingMessage}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {sending && !streamingMessage && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 dark:text-gray-400 rounded-2xl rounded-bl-md px-3 py-2 text-sm inline-flex items-center gap-2">
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask about this deal…"
            rows={2}
            disabled={sending}
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <div className="mt-1 text-[10px] text-gray-400">Enter to send · Shift+Enter for newline</div>
      </div>
    </div>
    </>
  );
}

function AssistantMessageToolbar({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string | null;
}) {
  const [copied, setCopied] = useState<"text" | "link" | null>(null);

  const handleCopyText = async () => {
    const ok = await copyMarkdownAsRichText(message.content);
    if (ok) {
      setCopied("text");
      window.setTimeout(() => setCopied(null), 1500);
    }
  };

  const handleCopyLink = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (conversationId) url.searchParams.set("chat", conversationId);
    url.hash = `msg-${message.id}`;
    navigator.clipboard.writeText(url.toString()).catch(() => {});
    setCopied("link");
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="flex items-center gap-1 mt-1 ml-1">
      <button
        type="button"
        onClick={handleCopyText}
        title="Copy this response"
        aria-label="Copy this response"
        className="p-1 text-gray-400 hover:text-purple-600 rounded transition-colors"
      >
        {copied === "text" ? (
          <span className="text-[10px] font-medium text-purple-600 px-0.5">Copied!</span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={handleCopyLink}
        title="Copy link to this response"
        aria-label="Copy link to this response"
        className="p-1 text-gray-400 hover:text-purple-600 rounded transition-colors"
      >
        {copied === "link" ? (
          <span className="text-[10px] font-medium text-purple-600 px-0.5">Copied!</span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
    </div>
  );
}

function ThreadSwitcher({
  threads,
  activeConversationId,
  onSelect,
}: {
  threads: DealChatThread[];
  activeConversationId: string | null;
  onSelect: (conversationId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = threads.find((t) => t.conversationId === activeConversationId);
  const currentLabel = active ? active.label : "New thread";

  const formatRel = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div ref={rootRef} className="relative border-b border-gray-200 dark:border-gray-700 bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-gray-400">Thread:</span>
          <span className="font-medium truncate">{currentLabel}</span>
        </span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {threads.length > 0 && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                !active
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200"
                  : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              }`}
              title={`${threads.length} prior thread${threads.length === 1 ? "" : "s"} available`}
            >
              {threads.length} {threads.length === 1 ? "thread" : "threads"}
            </span>
          )}
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 bg-white dark:bg-gray-800 border-b border-x border-gray-200 dark:border-gray-700 shadow-lg max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false); }}
            className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 hover:bg-purple-50 ${!active ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-700 dark:text-gray-200"}`}
          >
            <span className="text-gray-400">＋</span>
            New thread
          </button>
          <div className="border-t border-gray-100" />
          {threads.map((t) => {
            const isActive = t.conversationId === activeConversationId;
            return (
              <button
                key={t.conversationId}
                type="button"
                onClick={() => { onSelect(t.conversationId); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-xs flex items-center justify-between gap-2 hover:bg-purple-50 ${isActive ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-700 dark:text-gray-200"}`}
              >
                <span className="truncate flex-1 min-w-0">{t.label}</span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{formatRel(t.timestamp)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
