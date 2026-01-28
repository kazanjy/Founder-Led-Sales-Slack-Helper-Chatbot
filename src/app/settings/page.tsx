"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { DEFAULT_GTM_VARIABLES, StarterPrompt } from "@/lib/default-gtm-variables";

interface GtmVariableHistory {
  id: string;
  previousValue: string;
  changedAt: string;
}

interface GtmVariable {
  id: string;
  name: string;
  mergeField: string;
  description: string | null;
  value: string | null;
  aiAssistPrompt: string | null;
  isDefault: boolean;
  defaultVariableId: string | null;
  sortOrder: number;
  history: GtmVariableHistory[];
  createdAt: string;
  updatedAt: string;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
  workspaceName: string | null;
  licenseStatus: string;
}

interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [variables, setVariables] = useState<GtmVariable[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, remaining: 0 });
  const [selectedVariable, setSelectedVariable] = useState<GtmVariable | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // AI Assist state
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiSending, setAiSending] = useState(false);
  const [aiConversationId, setAiConversationId] = useState<string | null>(null);
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);

  // Get starter prompts for the selected variable
  const starterPrompts = useMemo((): StarterPrompt[] => {
    if (!selectedVariable?.defaultVariableId) return [];
    const defaultVar = DEFAULT_GTM_VARIABLES.find(
      (v) => v.id === selectedVariable.defaultVariableId
    );
    return defaultVar?.starterPrompts || [];
  }, [selectedVariable]);

  // Show toast notification
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Load user and variables on mount
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

        // Get GTM variables
        const varsRes = await fetch("/api/gtm-variables");
        const varsData = await varsRes.json();
        setVariables(varsData.variables || []);
        setStats(varsData.stats || { total: 0, completed: 0, remaining: 0 });
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  // Scroll AI messages to bottom
  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  // When selecting a variable, initialize edit value and reset AI chat
  const handleSelectVariable = (variable: GtmVariable) => {
    setSelectedVariable(variable);
    setEditValue(variable.value || "");
    setAiMessages([]);
    setAiConversationId(null);
    setAiInput("");
  };

  // Save variable value
  const handleSave = async () => {
    if (!selectedVariable) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/gtm-variables/${selectedVariable.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: editValue }),
      });

      const data = await res.json();
      if (data.variable) {
        // Update in list
        setVariables((prev) =>
          prev.map((v) => (v.id === selectedVariable.id ? data.variable : v))
        );
        setSelectedVariable(data.variable);

        // Update stats
        const completed = variables.filter((v) =>
          v.id === selectedVariable.id
            ? editValue.trim() !== ""
            : v.value && v.value.trim() !== ""
        ).length;
        setStats((prev) => ({
          ...prev,
          completed,
          remaining: prev.total - completed,
        }));

        showToast("Variable saved");
      }
    } catch (error) {
      console.error("Error saving variable:", error);
      showToast("Failed to save variable");
    } finally {
      setSaving(false);
    }
  };

  // Send AI Assist message
  const handleAiSend = async (directMessage?: string) => {
    const messageToUse = directMessage || aiInput.trim();
    if (!messageToUse || aiSending || !selectedVariable) return;

    const userMessage = messageToUse;
    setAiInput("");
    setAiSending(true);

    // Add user message to chat
    setAiMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      // If this is the first message, we need to create a conversation
      // and send the AI assist prompt as context
      const isFirstMessage = aiMessages.length === 0;

      // Build the message to send
      let messageToSend = userMessage;
      if (isFirstMessage && selectedVariable.aiAssistPrompt) {
        // Prepend the AI assist prompt as context
        messageToSend = `Context: I'm working on defining my "${selectedVariable.name}" (merge field: {{${selectedVariable.mergeField}}}).

${selectedVariable.aiAssistPrompt}

User's input: ${userMessage}`;
      }

      // Create conversation if needed
      let convId = aiConversationId;
      if (!convId) {
        const convRes = await fetch("/api/conversations", { method: "POST" });
        const convData = await convRes.json();
        if (convData.conversation) {
          convId = convData.conversation.id;
          setAiConversationId(convId);
        }
      }

      if (!convId) {
        throw new Error("Failed to create conversation");
      }

      // Send message
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      });

      const data = await res.json();
      if (data.message) {
        setAiMessages((prev) => [...prev, { role: "assistant", content: data.message.content }]);
      }
    } catch (error) {
      console.error("Error sending AI message:", error);
      setAiMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
      ]);
    } finally {
      setAiSending(false);
    }
  };

  // Start AI Assist with the default prompt
  const handleStartAiAssist = () => {
    if (!selectedVariable?.aiAssistPrompt) return;
    setAiInput("Let's get started!");
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
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* Left Panel - Variables List */}
      <div className="w-96 bg-gray-50 border-r border-gray-200 flex flex-col h-screen flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => router.push("/chat")}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Back to Chat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">GTM Variables</h1>
              <p className="text-sm text-gray-500">Configure your sales context</p>
            </div>
          </div>

          {/* Progress indicator */}
          <div className="bg-white rounded-lg p-3 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Setup Progress</span>
              <span className="text-sm text-gray-500">{stats.completed}/{stats.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
              />
            </div>
            {stats.remaining > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {stats.remaining} variable{stats.remaining !== 1 ? "s" : ""} remaining
              </p>
            )}
          </div>
        </div>

        {/* Variables List */}
        <div className="flex-1 overflow-y-auto">
          {variables.map((variable) => (
            <button
              key={variable.id}
              onClick={() => handleSelectVariable(variable)}
              className={`w-full p-4 text-left border-b border-gray-200 transition-colors ${
                selectedVariable?.id === variable.id
                  ? "bg-white border-l-4 border-l-blue-600"
                  : "hover:bg-gray-100"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{variable.name}</span>
                    {variable.value && variable.value.trim() !== "" ? (
                      <span className="text-green-600 text-xs">✓</span>
                    ) : (
                      <span className="text-orange-500 text-xs">○</span>
                    )}
                  </div>
                  <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {`{{${variable.mergeField}}}`}
                  </code>
                </div>
              </div>
              {variable.value && (
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                  {variable.value}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={() => router.push("/chat")}
            className="w-full py-2 px-4 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>

      {/* Right Panel - Variable Editor */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {selectedVariable ? (
          <>
            {/* Variable Header */}
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {selectedVariable.name}
              </h2>
              <code className="text-sm text-gray-500 bg-gray-200 px-2 py-1 rounded">
                {`{{${selectedVariable.mergeField}}}`}
              </code>
              {selectedVariable.description && (
                <p className="text-gray-600 mt-3">{selectedVariable.description}</p>
              )}
            </div>

            {/* Editor and AI Assist split */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Value Editor */}
              <div className="w-1/2 flex flex-col p-6 overflow-y-auto">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Value
                  </label>
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={`Enter your ${selectedVariable.name.toLowerCase()}...`}
                    className="w-full h-48 p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-[15px]"
                  />
                </div>

                <div className="flex items-center gap-3 mb-6">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {saving && (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {saving ? "Saving..." : "Save"}
                  </button>
                  {editValue !== (selectedVariable.value || "") && (
                    <span className="text-sm text-orange-600">Unsaved changes</span>
                  )}
                </div>

                {/* History Section */}
                {selectedVariable.history.length > 0 && (
                  <div className="mt-auto pt-6 border-t border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">History</h3>
                    <div className="space-y-3 max-h-48 overflow-y-auto">
                      {selectedVariable.history.map((h) => (
                        <div key={h.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-500">
                              {formatDate(h.changedAt)}
                            </span>
                            <button
                              onClick={() => setEditValue(h.previousValue)}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              Restore
                            </button>
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-3">
                            {h.previousValue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: AI Assist */}
              <div className="w-1/2 border-l border-gray-200 flex flex-col bg-gray-50">
                <div className="p-4 border-b border-gray-200 bg-white">
                  <h3 className="font-medium text-gray-900 flex items-center gap-2">
                    <span>🤖</span> AI Assist
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Get help defining your {selectedVariable.name.toLowerCase()}
                  </p>
                </div>

                {/* AI Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {aiMessages.length === 0 ? (
                    <div className="py-4">
                      <p className="text-gray-500 text-sm mb-4 text-center">
                        Need help? Start a conversation with Mikey to refine your {selectedVariable.name.toLowerCase()}.
                      </p>
                      {starterPrompts.length > 0 && (
                        <div className="space-y-2">
                          {starterPrompts.map((sp, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleAiSend(sp.prompt)}
                              className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-sm"
                            >
                              <span className="font-medium text-gray-900">{sp.label}</span>
                              <p className="text-gray-500 text-xs mt-1 line-clamp-1">{sp.prompt}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      {starterPrompts.length === 0 && selectedVariable.aiAssistPrompt && (
                        <div className="text-center">
                          <button
                            onClick={handleStartAiAssist}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                          >
                            Start AI Assist
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    aiMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-4 py-2 ${
                            msg.role === "user"
                              ? "bg-blue-600 text-white"
                              : "bg-white border border-gray-200 text-gray-900"
                          }`}
                        >
                          {msg.role === "assistant" ? (
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm">{msg.content}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {aiSending && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                        <div className="flex gap-1">
                          <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                          <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                          <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={aiMessagesEndRef} />
                </div>

                {/* AI Input */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAiSend();
                    }}
                    className="flex gap-2"
                  >
                    <textarea
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter submits, Shift+Enter or Cmd+Enter creates new line
                        if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          if (aiInput.trim() && !aiSending) {
                            handleAiSend();
                          }
                        }
                      }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = "auto";
                        target.style.height = Math.min(target.scrollHeight, 150) + "px";
                      }}
                      placeholder="Ask Mikey for help..."
                      disabled={aiSending}
                      rows={1}
                      style={{ height: "auto" }}
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none min-h-[44px] max-h-[150px]"
                    />
                    <button
                      type="submit"
                      disabled={aiSending || !aiInput.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors self-end"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* No variable selected */
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="text-6xl mb-4">⚙️</div>
              <h2 className="text-xl font-medium text-gray-900 mb-2">
                Configure Your GTM Variables
              </h2>
              <p className="text-gray-500 max-w-md">
                Select a variable from the left to start defining your sales context.
                These values will be used to personalize your prompts.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
