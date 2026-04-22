"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

interface DealChatPanelProps {
  open: boolean;
  onClose: () => void;
  dealName: string;
  buildContext: (question: string) => string;
  conversationId: string | null;
  onConversationCreated: (id: string, firstQuestion: string) => void;
}

export default function DealChatPanel({
  open,
  onClose,
  dealName,
  buildContext,
  conversationId,
  onConversationCreated,
}: DealChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        const loaded: Message[] = (data.messages || []).map((m: { id: string; role: string; content: string; createdAt: string }) => ({
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

  // Keep the scroll pinned to the bottom as messages stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingMessage]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] bg-white shadow-2xl border-l border-gray-200 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🌊</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">Deal Chat</div>
            <div className="text-[11px] text-gray-500 truncate">{dealName}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close chat panel"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streamingMessage && (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
            Ask Mikey anything about this deal. Mikey has the timeline, participants, latest analysis, and your sales narrative.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "USER" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "USER"
                  ? "max-w-[85%] bg-purple-600 text-white rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap"
                  : "max-w-[90%] bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md px-3 py-2 text-sm prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1"
              }
            >
              {m.role === "USER" ? (
                m.content
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
          </div>
        ))}
        {streamingMessage && (
          <div className="flex justify-start">
            <div className="max-w-[90%] bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md px-3 py-2 text-sm prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
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
            <div className="bg-gray-100 text-gray-500 rounded-2xl rounded-bl-md px-3 py-2 text-sm inline-flex items-center gap-2">
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-3">
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
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none disabled:opacity-60"
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
  );
}
