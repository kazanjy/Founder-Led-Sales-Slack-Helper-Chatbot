"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCmdEnterToSubmit } from "@/components/useCmdEnterToSubmit";

interface Recipient {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  lastSharedAt?: string;
}

interface Share {
  id: string;
  email: string;
  recipientName: string | null;
  recipientAvatar: string | null;
  hasAccount: boolean;
  createdAt: string;
}

interface ShareChatModalProps {
  conversationId: string;
  conversationTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareChatModal({
  conversationId,
  conversationTitle,
  isOpen,
  onClose,
}: ShareChatModalProps) {
  const [email, setEmail] = useState("");
  const [shares, setShares] = useState<Share[]>([]);
  const [teammates, setTeammates] = useState<Recipient[]>([]);
  const [recentRecipients, setRecentRecipients] = useState<Recipient[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [sharedWithAccount, setSharedWithAccount] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch current shares
  const fetchShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/${conversationId}/share`);
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares || []);
      }
    } catch {
      console.error("Failed to fetch shares");
    }
  }, [conversationId]);

  // Fetch recent recipients and teammates for typeahead
  const fetchRecentRecipients = useCallback(async (query: string = "") => {
    try {
      const res = await fetch(
        `/api/chat/share/recent${query ? `?q=${encodeURIComponent(query)}` : ""}`
      );
      if (res.ok) {
        const data = await res.json();
        setTeammates(data.teammates || []);
        setRecentRecipients(data.recipients || []);
      }
    } catch {
      console.error("Failed to fetch recent recipients");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      Promise.all([
        fetchShares(),
        fetchRecentRecipients(),
        // Load conversation privacy/sharing state
        fetch(`/api/conversations/${conversationId}`).then(async (r) => {
          if (r.ok) {
            const data = await r.json();
            setIsPrivate(data.conversation?.isPrivate || false);
            setSharedWithAccount(data.conversation?.sharedWithAccount || false);
          }
        }).catch(() => {}),
      ]).finally(() =>
        setLoading(false)
      );
      // Focus input after modal opens
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Reset state when closing
      setEmail("");
      setError(null);
      setSuccessMessage(null);
      setShowSuggestions(false);
    }
  }, [isOpen, fetchShares, fetchRecentRecipients, conversationId]);

  // Update suggestions as user types
  useEffect(() => {
    if (email.length >= 2) {
      fetchRecentRecipients(email);
    }
  }, [email, fetchRecentRecipients]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleShare = async () => {
    if (!email.trim()) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }

    setSharing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/chat/${conversationId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to share");
        return;
      }

      setSuccessMessage(
        data.share.hasAccount
          ? `Shared with ${data.share.recipientName || email}`
          : `Shared with ${email} (they'll see it when they sign up)`
      );
      setEmail("");
      fetchShares();
      fetchRecentRecipients();
    } catch {
      setError("Failed to share chat");
    } finally {
      setSharing(false);
    }
  };

  useCmdEnterToSubmit(handleShare, isOpen && !!email.trim() && !sharing);

  const handleUnshare = async (shareEmail: string) => {
    try {
      const res = await fetch(
        `/api/chat/${conversationId}/share?email=${encodeURIComponent(shareEmail)}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.email !== shareEmail));
      }
    } catch {
      console.error("Failed to unshare");
    }
  };

  const handleSelectRecipient = (recipient: Recipient) => {
    setEmail(recipient.email);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleShare();
    } else if (e.key === "Escape") {
      if (showSuggestions) {
        setShowSuggestions(false);
      } else {
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  // Filter suggestions to exclude already shared emails
  const sharedEmails = new Set(shares.map((s) => s.email.toLowerCase()));
  const filteredTeammates = teammates.filter(
    (t) => !sharedEmails.has(t.email.toLowerCase())
  );
  const filteredRecent = recentRecipients.filter(
    (r) => !sharedEmails.has(r.email.toLowerCase())
  );
  const hasSuggestions = filteredTeammates.length > 0 || filteredRecent.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Share Chat</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {conversationTitle && (
            <p className="text-sm text-gray-500 mt-1 truncate">
              {conversationTitle}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Email input with typeahead */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Share with email
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setShowSuggestions(true);
                    setError(null);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={handleKeyDown}
                  placeholder="colleague@company.com"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />

                {/* Suggestions dropdown */}
                {showSuggestions && hasSuggestions && (
                  <div
                    ref={suggestionsRef}
                    className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-10 max-h-56 overflow-y-auto"
                  >
                    {filteredTeammates.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                          Team
                        </div>
                        {filteredTeammates.map((teammate) => (
                          <button
                            key={teammate.email}
                            onClick={() => handleSelectRecipient(teammate)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
                          >
                            {teammate.avatarUrl ? (
                              <img src={teammate.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-purple-600 dark:text-purple-300 text-sm font-medium">
                                {teammate.name?.[0] || teammate.email[0].toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {teammate.name && (
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                  {teammate.name}
                                </div>
                              )}
                              <div className="text-sm text-gray-500 truncate">
                                {teammate.email}
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                    {filteredRecent.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                          Recent
                        </div>
                        {filteredRecent.map((recipient) => (
                          <button
                            key={recipient.email}
                            onClick={() => handleSelectRecipient(recipient)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
                          >
                            {recipient.avatarUrl ? (
                              <img src={recipient.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-300 text-sm">
                                {recipient.name?.[0] || recipient.email[0].toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {recipient.name && (
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                  {recipient.name}
                                </div>
                              )}
                              <div className="text-sm text-gray-500 truncate">
                                {recipient.email}
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleShare}
                disabled={sharing || !email.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {sharing ? "Sharing..." : "Share"}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}

          {/* Success message */}
          {successMessage && (
            <p className="mt-2 text-sm text-green-600">{successMessage}</p>
          )}

          {/* Account sharing & privacy toggles */}
          <div className="mt-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Share with entire account</p>
                <p className="text-xs text-gray-500">All team members can view this chat</p>
              </div>
              <button
                onClick={async () => {
                  const newValue = !sharedWithAccount;
                  setSharedWithAccount(newValue);
                  if (newValue) setIsPrivate(false);
                  await fetch(`/api/conversations/${conversationId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sharedWithAccount: newValue, ...(newValue ? { isPrivate: false } : {}) }),
                  });
                }}
                disabled={isPrivate}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  sharedWithAccount ? "bg-purple-600" : "bg-gray-300 dark:bg-gray-600"
                } ${isPrivate ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  sharedWithAccount ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Private</p>
                <p className="text-xs text-gray-500">Only you can see this chat (not visible to account members)</p>
              </div>
              <button
                onClick={async () => {
                  const newValue = !isPrivate;
                  setIsPrivate(newValue);
                  if (newValue) setSharedWithAccount(false);
                  await fetch(`/api/conversations/${conversationId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ isPrivate: newValue, ...(newValue ? { sharedWithAccount: false } : {}) }),
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isPrivate ? "bg-red-500" : "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isPrivate ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
          </div>

          {/* Current shares */}
          {loading ? (
            <div className="mt-4 text-center text-gray-500">Loading...</div>
          ) : shares.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Shared with
              </h3>
              <div className="space-y-2">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-800 rounded-md"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {share.recipientAvatar ? (
                        <img
                          src={share.recipientAvatar}
                          alt=""
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                          {share.recipientName?.[0] || share.email[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        {share.recipientName && (
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {share.recipientName}
                          </div>
                        )}
                        <div className="text-sm text-gray-500 truncate">
                          {share.email}
                        </div>
                        {!share.hasAccount && (
                          <div className="text-xs text-amber-600">
                            Not signed up yet
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnshare(share.email)}
                      className="text-gray-400 hover:text-red-500 p-1"
                      title="Remove access"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500 text-center">
              This chat isn&apos;t shared with anyone yet
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800 rounded-b-lg border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500">
            Account members can view chats via direct URL. Shared chats are read-only — recipients can clone to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
