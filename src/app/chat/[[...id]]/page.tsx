"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";

/**
 * Format a date as relative time (e.g., "2m ago", "3h ago", "Yesterday", "Jan 15")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    // Show month and day for older messages
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
  workspaceName: string | null;
  licenseStatus: string;
  trialDaysRemaining: number;
  canChat: boolean;
  chatBlockedMessage: string;
}

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  source: "SLACK" | "WEB";
  title: string | null;
  firstMessagePreview: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export default function ChatPage() {
  const router = useRouter();
  const params = useParams();

  // Get conversation ID from URL params (optional catch-all returns array)
  const conversationIdFromUrl = params.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(conversationIdFromUrl);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Update URL when conversation changes
  const selectConversation = (conversationId: string | null) => {
    setSelectedConversation(conversationId);
    if (conversationId) {
      router.push(`/chat/${conversationId}`, { scroll: false });
    } else {
      router.push('/chat', { scroll: false });
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load user and conversations on mount
  useEffect(() => {
    async function loadData() {
      try {
        // Get current user
        const userRes = await fetch("/api/auth/me");
        const userData = await userRes.json();

        if (!userData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        setUser(userData.user);

        // Get conversations
        const convsRes = await fetch("/api/conversations");
        const convsData = await convsRes.json();
        setConversations(convsData.conversations || []);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  // Load messages when conversation is selected
  useEffect(() => {
    async function loadMessages() {
      if (!selectedConversation) {
        setMessages([]);
        return;
      }

      try {
        const res = await fetch(`/api/conversations/${selectedConversation}`);
        const data = await res.json();
        setMessages(data.conversation?.messages || []);
      } catch (error) {
        console.error("Error loading messages:", error);
      }
    }

    loadMessages();
  }, [selectedConversation]);

  const handleNewChat = async () => {
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      const data = await res.json();

      if (data.conversation) {
        setConversations([data.conversation, ...conversations]);
        selectConversation(data.conversation.id);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || sending || !user?.canChat) return;

    // If no conversation selected, create one first
    let conversationId = selectedConversation;
    if (!conversationId) {
      try {
        const res = await fetch("/api/conversations", { method: "POST" });
        const data = await res.json();
        if (data.conversation) {
          conversationId = data.conversation.id;
          setConversations([data.conversation, ...conversations]);
          selectConversation(conversationId);
        }
      } catch (error) {
        console.error("Error creating conversation:", error);
        return;
      }
    }

    const userMessage = messageText.trim();
    setInputMessage("");
    setSending(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await res.json();

      if (data.error) {
        alert(data.error);
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        return;
      }

      // Add assistant response
      setMessages((prev) => [...prev, data.message]);

      // Update conversation in list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                firstMessagePreview: c.firstMessagePreview || userMessage.substring(0, 100),
                messageCount: c.messageCount + 2,
                lastMessageAt: new Date().toISOString(),
              }
            : c
        )
      );
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setSending(false);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputMessage);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* Sidebar - fixed height, doesn't scroll with chat */}
      <div className="w-80 bg-gray-100 border-r border-gray-200 flex flex-col h-screen flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-10 h-10 rounded-lg"
          />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mikey</h1>
            <p className="text-sm text-gray-500">{user?.workspaceName}</p>
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <button
            onClick={handleNewChat}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Chat
          </button>
        </div>

        {/* Conversations List - this part scrolls independently */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No conversations yet. Start a new chat!
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`w-full p-4 text-left border-b border-gray-200 hover:bg-gray-200 transition-colors ${
                  selectedConversation === conv.id ? "bg-white" : ""
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">
                    {conv.source === "SLACK" ? "💬 Slack" : "🌐 Web"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatRelativeTime(conv.lastMessageAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-900 truncate">
                  {conv.title || conv.firstMessagePreview || "New conversation"}
                </p>
              </button>
            ))
          )}
        </div>

        {/* User Info - stays at bottom */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">
              {user?.name || user?.email || "User"}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign Out
            </button>
          </div>
          <div className="text-xs text-gray-500">
            {user?.licenseStatus === "ACTIVE" ? (
              <span className="text-green-600">✓ Licensed</span>
            ) : user?.licenseStatus === "TRIAL" ? (
              <span className="text-blue-600">
                🎁 Trial ({user.trialDaysRemaining} days left)
              </span>
            ) : (
              <span className="text-red-600">Trial ended</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Area - scrolls independently */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-[600px]">
                <img
                  src="/mikey-avatar.png"
                  alt="Mikey"
                  className="w-24 h-24 rounded-2xl mx-auto mb-6"
                />
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Welcome to Mikey
                </h2>
                <p className="text-gray-500 mb-8">
                  Your Founder-Led Sales assistant
                </p>

                <p className="text-sm text-gray-500 mb-4">
                  Some ideas to start with:
                </p>
                <div className="space-y-2">
                  {[
                    "📏 Can you help me measure my GTM maturity?",
                    "🔍 What would be good discovery questions for my product?",
                    "🎯 Can you help me tighten my ideal customer profile?",
                    "📧 What would be good outbound messaging for my product?",
                    "📝 Can you help me write an outbound sequence?",
                    "📞 Can you help me structure an effective first call?",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt.slice(2).trim())}
                      className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700 text-sm"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[800px] mx-auto space-y-6">
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.role === "USER" ? (
                    <div className="flex justify-end">
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-w-[70%]">
                        <p className="whitespace-pre-wrap text-gray-900 text-[17px]">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 mt-4 text-[17px]">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-gray-500 mt-4">
                  <div className="animate-pulse">●</div>
                  <span>Mikey is thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 p-4 bg-white">
          {!user?.canChat ? (
            <div className="max-w-[800px] mx-auto text-center py-4">
              <p className="text-red-600 mb-2">{user?.chatBlockedMessage}</p>
              <button className="text-blue-600 hover:underline">
                Subscribe to continue
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendMessage} className="max-w-[800px] mx-auto">
              <div className="flex gap-4 items-end">
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter submits, Shift+Enter or Cmd+Enter creates new line
                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      if (inputMessage.trim() && !sending) {
                        handleSendMessage(e);
                      }
                    }
                  }}
                  placeholder="Ask Mikey anything about founder-led sales..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none min-h-[52px] max-h-[200px] text-[17px]"
                  disabled={sending}
                  rows={1}
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                  }}
                />
                <button
                  type="submit"
                  disabled={!inputMessage.trim() || sending}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  Send
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
