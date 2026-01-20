"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";

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

export default function SharedChatPage() {
  const params = useParams();
  const code = params.code as string;

  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-16 h-16 rounded-xl mx-auto mb-4"
          />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Oops!</h1>
          <p className="text-gray-500">{error}</p>
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
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 flex-shrink-0">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-semibold text-gray-900">Mikey</span>
          </a>
          <span className="text-sm text-gray-500 text-center hidden sm:block">
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
            <div key={msg.id}>
              {msg.role === "USER" ? (
                <div className="flex justify-end">
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-w-[70%]">
                    <p className="whitespace-pre-wrap text-gray-900 text-[17px]">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 mt-4 text-[17px]">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-4">
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
