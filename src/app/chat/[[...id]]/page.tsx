"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";

// Saved Prompt interface
interface SavedPrompt {
  id: string;
  emoji: string;
  title: string;
  prompt: string;
  isDefault: boolean;
}

// Default prompts that ship with the app
const DEFAULT_PROMPTS: SavedPrompt[] = [
  // Column 1: Foundation & Discovery
  { id: "default-1", emoji: "📏", title: "Can you help me measure my GTM maturity?", prompt: "Can you help me measure my GTM maturity?", isDefault: true },
  { id: "default-2", emoji: "🎯", title: "Can you help me tighten my ideal customer profile?", prompt: "Can you help me tighten my ideal customer profile?", isDefault: true },
  { id: "default-3", emoji: "🔍", title: "What would be good discovery questions for my product?", prompt: "What would be good discovery questions for my product?", isDefault: true },
  { id: "default-4", emoji: "📞", title: "Can you help me structure an effective first call?", prompt: "Can you help me structure an effective first call?", isDefault: true },
  // Column 2: Outreach & Execution
  { id: "default-5", emoji: "📧", title: "What would be good outbound messaging for my product?", prompt: "What would be good outbound messaging for my product?", isDefault: true },
  { id: "default-6", emoji: "📝", title: "Can you help me write an outbound sequence?", prompt: "Can you help me write an outbound sequence?", isDefault: true },
  { id: "default-7", emoji: "📚", title: "Can you help me put together my sales playbook?", prompt: "Can you help me put together my sales playbook?", isDefault: true },
  { id: "default-8", emoji: "💰", title: "Help me design a comp plan for a first sales rep.", prompt: "Help me design a comp plan for a first sales rep.", isDefault: true },
  // Column 3: Team & Education
  { id: "default-9", emoji: "👥", title: "Can you give me guidance on a good sales rep hiring process?", prompt: "Can you give me guidance on a good sales rep hiring process?", isDefault: true },
  { id: "default-10", emoji: "🚀", title: "What would be an effective sales rep onboarding plan?", prompt: "What would be an effective sales rep onboarding plan?", isDefault: true },
  { id: "default-11", emoji: "🧠", title: "Take a quiz on your founder-led sales expertise.", prompt: "Can you give me a 20 question quiz about founder-led sales concepts, one question at a time? Test my expertise!", isDefault: true },
  { id: "default-12", emoji: "📖", title: "Give me a tutoring session on founder-led sales.", prompt: "Can you give me a short lesson on founder-led sales, and then quiz me on what we've covered? Give me some topic options to choose from first.", isDefault: true },
  // New: Pre-call planning
  { id: "default-13", emoji: "🗓️", title: "Help me prepare for a call.", prompt: "Help me do precall planning for a customer call. Ask me about the customer I'm meeting, and some details about my product as a means by which to help me prepare. Remind me to edit the saved prompt if I want to add those details going forward.", isDefault: true },
];

const STORAGE_KEY = "mikey-saved-prompts";

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
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [toast, setToast] = useState<{ message: string; position: "left" | "right" | "bottom" } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [isAddingPrompt, setIsAddingPrompt] = useState(false);
  const [draggedPromptId, setDraggedPromptId] = useState<string | null>(null);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  // Load saved prompts from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSavedPrompts(parsed);
      } catch {
        setSavedPrompts(DEFAULT_PROMPTS);
      }
    } else {
      setSavedPrompts(DEFAULT_PROMPTS);
    }
    setPromptsLoaded(true);
  }, []);

  // Save prompts to localStorage when they change
  useEffect(() => {
    if (promptsLoaded && savedPrompts.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPrompts));
    }
  }, [savedPrompts, promptsLoaded]);

  // Reset a single prompt to its default (only for default prompts)
  const handleResetPromptToDefault = (promptId: string) => {
    const defaultPrompt = DEFAULT_PROMPTS.find((p) => p.id === promptId);
    if (defaultPrompt) {
      setSavedPrompts((prev) =>
        prev.map((p) => (p.id === promptId ? { ...defaultPrompt } : p))
      );
      setEditingPrompt({ ...defaultPrompt });
    }
  };

  // Check if a prompt can be reset (is a default prompt that's been modified)
  const canResetPrompt = (prompt: SavedPrompt): boolean => {
    if (!prompt.id.startsWith("default-")) return false;
    const defaultPrompt = DEFAULT_PROMPTS.find((p) => p.id === prompt.id);
    if (!defaultPrompt) return false;
    return (
      prompt.title !== defaultPrompt.title ||
      prompt.prompt !== defaultPrompt.prompt ||
      prompt.emoji !== defaultPrompt.emoji
    );
  };

  // Save edited prompt
  const handleSavePrompt = (prompt: SavedPrompt) => {
    if (isAddingPrompt) {
      // Adding new prompt
      setSavedPrompts((prev) => [...prev, { ...prompt, isDefault: false }]);
    } else {
      // Editing existing prompt
      setSavedPrompts((prev) =>
        prev.map((p) => (p.id === prompt.id ? { ...prompt, isDefault: false } : p))
      );
    }
    setEditingPrompt(null);
    setIsAddingPrompt(false);
  };

  // Clone a prompt
  const handleClonePrompt = (prompt: SavedPrompt) => {
    const cloned: SavedPrompt = {
      ...prompt,
      id: `custom-${Date.now()}`,
      title: `${prompt.title} (copy)`,
      isDefault: false,
    };
    setSavedPrompts((prev) => [...prev, cloned]);
  };

  // Delete a prompt
  const handleDeletePrompt = (promptId: string) => {
    setSavedPrompts((prev) => prev.filter((p) => p.id !== promptId));
  };

  // Add new prompt
  const handleAddPrompt = () => {
    setEditingPrompt({
      id: `custom-${Date.now()}`,
      emoji: "💡",
      title: "",
      prompt: "",
      isDefault: false,
    });
    setIsAddingPrompt(true);
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, promptId: string) => {
    setDraggedPromptId(promptId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetPromptId: string) => {
    e.preventDefault();
    if (!draggedPromptId || draggedPromptId === targetPromptId) return;

    setSavedPrompts((prev) => {
      const newPrompts = [...prev];
      const draggedIndex = newPrompts.findIndex((p) => p.id === draggedPromptId);
      const targetIndex = newPrompts.findIndex((p) => p.id === targetPromptId);

      if (draggedIndex === -1 || targetIndex === -1) return prev;

      const [draggedPrompt] = newPrompts.splice(draggedIndex, 1);
      newPrompts.splice(targetIndex, 0, draggedPrompt);

      return newPrompts;
    });
    setDraggedPromptId(null);
  }, [draggedPromptId]);

  const handleDragEnd = useCallback(() => {
    setDraggedPromptId(null);
  }, []);

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
  const showToast = (message: string, position: "left" | "right" | "bottom" = "right") => {
    setToast({ message, position });
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

  // Share conversation (header button)
  const handleShare = async () => {
    if (!selectedConversation || messages.length === 0 || sharing) return;

    setSharing(true);
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
    } finally {
      setSharing(false);
    }
  };

  // Share conversation (inline button under messages)
  const handleInlineShare = async () => {
    if (!selectedConversation || messages.length === 0 || sharing) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.", "bottom");
      } else {
        showToast("Failed to share conversation", "bottom");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation", "bottom");
    } finally {
      setSharing(false);
    }
  };

  // Share a specific conversation from the sidebar menu
  const handleShareConversation = async (conversationId: string) => {
    setSharingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.", "left");
      } else {
        showToast("Failed to share conversation", "left");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation", "left");
    } finally {
      setSharingId(null);
      setOpenMenuId(null);
    }
  };

  // Archive a conversation
  const handleArchiveConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    setArchivingId(conversationId);
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
        showToast("Conversation archived", "left");
      } else {
        showToast("Failed to archive conversation", "left");
      }
    } catch (error) {
      console.error("Error archiving:", error);
      showToast("Failed to archive conversation", "left");
    } finally {
      setArchivingId(null);
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
        showToast("Conversation deleted", "left");
      } else {
        showToast("Failed to delete conversation", "left");
      }
    } catch (error) {
      console.error("Error deleting:", error);
      showToast("Failed to delete conversation", "left");
    }
  };

  // Update URL when conversation changes (without full page reload)
  const selectConversation = (conversationId: string | null) => {
    setSelectedConversation(conversationId);
    isInitialLoad.current = true; // Reset for new conversation
    // Use pushState to update URL without triggering Next.js navigation
    const newUrl = conversationId ? `/chat/${conversationId}` : '/chat';
    window.history.pushState({}, '', newUrl);
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

      setLoadingMessages(true);
      try {
        const res = await fetch(`/api/conversations/${selectedConversation}`);
        const data = await res.json();
        setMessages(data.conversation?.messages || []);
      } catch (error) {
        console.error("Error loading messages:", error);
      } finally {
        setLoadingMessages(false);
      }
    }

    loadMessages();
  }, [selectedConversation]);

  const handleNewChat = async () => {
    if (creatingChat) return;
    setCreatingChat(true);
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
    } finally {
      setCreatingChat(false);
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
        <div className="flex items-center gap-2 text-gray-500">
          <div className="flex gap-1">
            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
            <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
            <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
          </div>
          <span>Mikey is thinking...</span>
        </div>
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
            disabled={creatingChat}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {creatingChat ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </>
            ) : (
              "+ New Chat"
            )}
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
                  archivingId === conv.id ? "opacity-50" : ""
                } ${
                  selectedConversation === conv.id ? "bg-white" : "hover:bg-gray-200"
                } ${openMenuId === conv.id ? "z-50" : ""}`}
              >
                <button
                  onClick={() => selectConversation(conv.id)}
                  disabled={archivingId === conv.id}
                  className="w-full p-4 text-left transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {archivingId === conv.id ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-[13px] text-gray-400">Archiving...</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[13px] text-gray-400">
                          {conv.source === "SLACK" ? "💬 Slack" : "🌐 Web"}
                        </span>
                        <span className="text-[13px] text-gray-400">
                          {formatRelativeTime(conv.lastMessageAt)}
                        </span>
                      </>
                    )}
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
                        disabled={sharingId === conv.id}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                      >
                        {sharingId === conv.id ? (
                          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="18" cy="5" r="3"></circle>
                            <circle cx="6" cy="12" r="3"></circle>
                            <circle cx="18" cy="19" r="3"></circle>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                          </svg>
                        )}
                        {sharingId === conv.id ? "Sharing..." : "Share"}
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
              <div className="flex items-center justify-between">
                <span className="text-green-600">✓ Licensed</span>
                <button
                  onClick={async () => {
                    const res = await fetch("/api/stripe/portal", { method: "POST" });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  }}
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Manage
                </button>
              </div>
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
        {/* Top header with Upgrade and Copy/Share buttons */}
        <div className="border-b border-gray-200 px-6 py-3 flex justify-between items-center bg-white">
          <div>
            {/* Left side - empty for now */}
          </div>
          <div className="flex items-center gap-2">
            {/* Upgrade button - show for non-active users */}
            {user && user.licenseStatus !== "ACTIVE" && (
              <a
                href="/upgrade"
                className="px-4 py-1.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold rounded-lg hover:from-pink-600 hover:to-purple-600 transition-all shadow-sm"
              >
                Upgrade
              </a>
            )}
            {/* Copy/Share buttons - only show when messages exist */}
            {messages.length > 0 && (
              <>
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
                  disabled={sharing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {sharing ? (
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3"></circle>
                      <circle cx="6" cy="12" r="3"></circle>
                      <circle cx="18" cy="19" r="3"></circle>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                  )}
                  {sharing ? "Sharing..." : "Share"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-500">
                <div className="flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
                </div>
                <span>Mikey is thinking...</span>
              </div>
            </div>
          ) : messages.length === 0 ? (
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

                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-gray-500">
                    Some ideas to start with:
                  </p>
                  <button
                    onClick={handleAddPrompt}
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    + Add Prompt
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {savedPrompts.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, item.id)}
                      onDragEnd={handleDragEnd}
                      className={`group relative flex items-center gap-3 text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-grab active:cursor-grabbing ${
                        draggedPromptId === item.id ? "opacity-50" : ""
                      }`}
                    >
                      <button
                        onClick={() => sendMessage(item.prompt)}
                        className="flex items-center gap-3 text-left flex-1 min-w-0"
                      >
                        <span className="text-2xl flex-shrink-0">{item.emoji}</span>
                        <span className="text-gray-700 text-sm truncate">{item.title}</span>
                      </button>
                      {/* Edit/Clone/Delete buttons - appear on hover */}
                      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPrompt(item);
                            setIsAddingPrompt(false);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                          title="Edit"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClonePrompt(item);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                          title="Clone"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePrompt(item.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded"
                          title="Delete"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3 text-center">
                  Drag prompts to reorder. Hover to edit, clone, or delete.
                </p>
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
                              showToast("Copied to clipboard!", "bottom");
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
                            onClick={handleInlineShare}
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
        <div className={`fixed bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 ${
          toast.position === "left"
            ? "top-16 left-6"
            : toast.position === "bottom"
            ? "bottom-24 left-1/2 -translate-x-1/2 ml-40"
            : "top-16 right-6"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Edit Prompt Modal */}
      {editingPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                {isAddingPrompt ? "Add New Prompt" : "Edit Prompt"}
              </h2>

              <div className="space-y-4">
                {/* Emoji picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Emoji
                  </label>
                  <input
                    type="text"
                    value={editingPrompt.emoji}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, emoji: e.target.value.slice(0, 2) })
                    }
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-2xl text-center"
                    maxLength={2}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Button Title
                  </label>
                  <input
                    type="text"
                    value={editingPrompt.title}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, title: e.target.value })
                    }
                    placeholder="What users see on the button"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This is what appears on the button tile.
                  </p>
                </div>

                {/* Prompt */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Actual Prompt
                  </label>
                  <textarea
                    value={editingPrompt.prompt}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, prompt: e.target.value })
                    }
                    placeholder="The actual prompt that gets sent to Mikey"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] resize-y"
                    rows={4}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This is the actual message sent to Mikey. Can be different from the button title to create richer prompts.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-200">
                <div>
                  {!isAddingPrompt && canResetPrompt(editingPrompt) && (
                    <button
                      onClick={() => handleResetPromptToDefault(editingPrompt.id)}
                      className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Reset to Default
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setEditingPrompt(null);
                      setIsAddingPrompt(false);
                    }}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSavePrompt(editingPrompt)}
                    disabled={!editingPrompt.title.trim() || !editingPrompt.prompt.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAddingPrompt ? "Add Prompt" : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
