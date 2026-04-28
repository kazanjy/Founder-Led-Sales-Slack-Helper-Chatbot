"use client";

import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { TruncatedUserMessage } from "@/components/TruncatedUserMessage";

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

interface SharedConversation {
  id: string;
  title: string | null;
  firstMessagePreview: string | null;
  messages: Message[];
  createdAt: string;
}

interface SharePageClientProps {
  code: string;
}

export default function SharePageClient({ code }: SharePageClientProps) {
  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const hasScrolledToAnchor = useRef(false);

  useEffect(() => {
    async function loadSharedConversation() {
      try {
        const res = await fetch(`/api/share/${code}`);
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setConversation(data.conversation);
        }
      } catch (err) {
        console.error("Error loading shared conversation:", err);
        setError("Failed to load conversation");
      } finally {
        setLoading(false);
      }
    }

    loadSharedConversation();
  }, [code]);

  // Scroll to anchor after conversation loads
  useEffect(() => {
    if (conversation && !hasScrolledToAnchor.current) {
      hasScrolledToAnchor.current = true;
      const hash = window.location.hash;
      if (hash) {
        // Small delay to ensure DOM is rendered
        setTimeout(() => {
          const element = document.getElementById(hash.slice(1));
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [conversation]);

  const copyMessageLink = (messageId: string) => {
    const url = `${window.location.origin}/share/${code}#msg-${messageId}`;
    navigator.clipboard.writeText(url);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-16 h-16 rounded-xl mx-auto mb-4"
          />
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Oops!</h1>
          <p className="text-gray-500 dark:text-gray-400">{error}</p>
          <a
            href="/"
            className="inline-block mt-4 text-blue-600 hover:underline"
          >
            Go to Mikey
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sticky top-0 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 flex-shrink-0">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Mikey</span>
          </a>
          <span className="text-sm text-gray-500 dark:text-gray-400 text-center hidden sm:block">
            This is a shared conversation from Mikey, the Founder-Led Sales assistant.
          </span>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-5 h-5 rounded"
            />
            Try Mikey
          </a>
        </div>
      </header>

      {/* Chat content */}
      <main className="max-w-[800px] mx-auto px-6 py-8">
        <div className="space-y-6">
          {conversation?.messages.map((msg) => (
            <div key={msg.id} id={`msg-${msg.id}`} className="scroll-mt-20">
              {msg.role === "USER" ? (
                <div className="flex justify-end">
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 max-w-[70%]">
                    <TruncatedUserMessage content={msg.content} />
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 mt-4 text-[17px]">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {/* Share this response button */}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => copyMessageLink(msg.id)}
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      {copiedMessageId === msg.id ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Link copied!
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                          </svg>
                          Share this response
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            This is a shared conversation from Mikey, the Founder-Led Sales assistant.
          </p>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-5 h-5 rounded"
            />
            Try Mikey
          </a>
        </div>
      </main>
    </div>
  );
}
