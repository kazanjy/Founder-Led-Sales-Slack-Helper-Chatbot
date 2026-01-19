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
  archived?: boolean;
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
  const [toast, setToast] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Show toast notification
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Copy conversation as markdown
  const handleCopy = () => {
    if (messages.length === 0) return;

    const markdown = messages
      .map((msg) => {
        if (msg.role === "USER") {
          return `**You:** ${msg.content}`;
        } else {
          return `**Mikey:** ${msg.content}`;
        }
      })
      .join("\n\n---\n\n");

    navigator.clipboard.writeText(markdown);
    showToast("Copied to clipboard!");
  };

  // Share conversation
  const handleShare = async () => {
    if (!selectedConversation || messages.length === 0) return;

    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.");
      } else {
        showToast("Failed to share conversation");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation");
    }
  };

  // Share a specific conversation from the sidebar menu
  const handleShareConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.");
      } else {
        showToast("Failed to share conversation");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation");
    }
  };

  // Archive a conversation
  const handleArchiveConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (res.ok) {
        // Remove from list
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        // If this was selected, clear selection
        if (selectedConversation === conversationId) {
          selectConversation(null);
        }
        showToast("Conversation archived");
      } else {
        showToast("Failed to archive conversation");
      }
    } catch (error) {
      console.error("Error archiving:", error);
      showToast("Failed to archive conversation");
    }
  };

  // Delete a conversation
  const handleDeleteConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    if (!confirm("Are you sure you want to delete this conversation? This cannot be undone.")) {
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        // Remove from list
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        // If this was selected, clear selection
        if (selectedConversation === conversationId) {
          selectConversation(null);
        }
        showToast("Conversation deleted");
      } else {
        showToast("Failed to delete conversation");
      }
    } catch (error) {
      console.error("Error deleting:", error);
      showToast("Failed to delete conversation");
    }
  };

  // Update URL when conversation changes
  const selectConversation = (conversationId: string | null) => {
    setSelectedConversation(conversationId);
    isInitialLoad.current = true; // Reset for new conversation
    if (conversationId) {
      router.push(`/chat/${conversationId}`, { scroll: false });
    } else {
      router.push('/chat', { scroll: false });
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Double requestAnimationFrame ensures content is fully painted
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isInitialLoad.current) {
            // For initial load, scroll instantly without animation
            messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
            isInitialLoad.current = false;
          } else {
            // For new messages, smooth scroll
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }
        });
      });
    }
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

      // Update conversation in list and move to top (most recent)
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                firstMessagePreview: c.firstMessagePreview || userMessage.substring(0, 100),
                messageCount: c.messageCount + 2,
                lastMessageAt: new Date().toISOString(),
              }
            : c
        );
        // Sort by lastMessageAt descending
        return updated.sort((a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        );
      });
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
              <div
                key={conv.id}
                className={`relative group border-b border-gray-200 ${
                  selectedConversation === conv.id ? "bg-white" : "hover:bg-gray-200"
                } ${openMenuId === conv.id ? "z-50" : ""}`}
              >
                <button
                  onClick={() => selectConversation(conv.id)}
                  className="w-full p-4 text-left transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] text-gray-400">
                      {conv.source === "SLACK" ? "💬 Slack" : "🌐 Web"}
                    </span>
                    <span className="text-[13px] text-gray-400">
                      {formatRelativeTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <p className="text-[15px] text-gray-900 truncate pr-8">
                    {conv.title || conv.firstMessagePreview || "New conversation"}
                  </p>
                </button>

                {/* Three-dot menu button */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                    }}
                    className={`p-1.5 rounded hover:bg-gray-300 transition-colors ${
                      openMenuId === conv.id ? "bg-gray-300" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-gray-600">
                      <circle cx="12" cy="5" r="2"></circle>
                      <circle cx="12" cy="12" r="2"></circle>
                      <circle cx="12" cy="19" r="2"></circle>
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {openMenuId === conv.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShareConversation(conv.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3"></circle>
                          <circle cx="6" cy="12" r="3"></circle>
                          <circle cx="18" cy="19" r="3"></circle>
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                        </svg>
                        Share
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveConversation(conv.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="21 8 21 21 3 21 3 8"></polyline>
                          <rect x="1" y="3" width="22" height="5"></rect>
                          <line x1="10" y1="12" x2="14" y2="12"></line>
                        </svg>
                        Archive
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConversation(conv.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
        {/* Chat header with Copy/Share buttons */}
        {messages.length > 0 && (
          <div className="border-b border-gray-200 px-6 py-3 flex justify-end gap-2 bg-white">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
              Share
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-[600px]">
                <img
                  src="/mikey-avatar.png"
                  alt="Mikey"
                  className="w-48 h-48 rounded-3xl mx-auto mb-6"
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
                    <div>
                      <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 mt-4 text-[17px]">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      {/* Copy/Share buttons for this response */}
                      <div className="flex items-center gap-1 mt-2">
                        <div className="relative group">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              showToast("Copied to clipboard!");
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Copy
                          </span>
                        </div>
                        <div className="relative group">
                          <button
                            onClick={handleShare}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="18" cy="5" r="3"></circle>
                              <circle cx="6" cy="12" r="3"></circle>
                              <circle cx="18" cy="19" r="3"></circle>
                              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                          </button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Share
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-gray-500 mt-4">
                  <div className="flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
                  </div>
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

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
