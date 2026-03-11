"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useConfirmModal } from "@/components/useConfirmModal";

interface UserDetail {
  id: string;
  email: string | null;
  secondaryEmails: string[];
  slackEmail: string | null;
  name: string | null;
  slackUserName: string | null;
  avatarUrl: string | null;
  googleId: string | null;
  slackUserId: string | null;
  licenseStatus: string;
  trialStartedAt: string | null;
  trialDaysRemaining: number | null;
  workspaceId: string | null;
  workspace: {
    id: string;
    slackTeamId: string;
    slackTeamName: string;
    installedAt: string;
  } | null;
  licenseId: string | null;
  license: {
    id: string;
    type: string;
    status: string;
    expiresAt: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    manuallyGranted: boolean;
    notes: string | null;
  } | null;
  messagesToday: number;
  referralCode: string;
  bonusMessagesEarned: number;
  conversationCount: number;
  messageCount: number;
  referralCount: number;
  dismissedDefaultPromptIds: string[];
  conversations: {
    id: string;
    title: string | null;
    firstMessagePreview: string | null;
    messageCount: number;
    source: string;
    createdAt: string;
    lastMessageAt: string;
  }[];
  activity: {
    id: string;
    type: string;
    label: string;
    title: string | null;
    link: string;
    createdAt: string;
  }[];
  sessions: {
    id: string;
    createdAt: string;
    expiresAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const [newSecondaryEmail, setNewSecondaryEmail] = useState("");
  const [mergeUserId, setMergeUserId] = useState("");
  const [merging, setMerging] = useState(false);
  const { confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  const handleImpersonate = async () => {
    const confirmed = await showConfirm({
      title: "Login as User",
      message: `Are you sure you want to log in as ${user?.name || user?.email || "this user"}? You will be redirected to the chat page as this user.`,
      variant: "warning",
      confirmLabel: "Login as User",
    });
    if (!confirmed) return;

    setImpersonating(true);
    try {
      const res = await fetch(`/api/admin/users/${params.id}/impersonate`, {
        method: "POST",
      });
      const data = await res.json();

      if (res.ok && data.redirectTo) {
        router.push(data.redirectTo);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to impersonate user" });
        setImpersonating(false);
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
      setMessage({ type: "error", text: "Failed to impersonate user" });
      setImpersonating(false);
    }
  };

  const handleImpersonateToLink = async (link: string) => {
    if (impersonating) return;
    setImpersonating(true);
    try {
      const res = await fetch(
        `/api/admin/users/${params.id}/impersonate?redirectTo=${encodeURIComponent(link)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok && data.redirectTo) {
        window.open(data.redirectTo, "_blank");
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
    } finally {
      setImpersonating(false);
    }
  };

  const activityTypeColors: Record<string, string> = {
    "narrative": "bg-blue-100 text-blue-700",
    "discovery": "bg-indigo-100 text-indigo-700",
    "checklist": "bg-cyan-100 text-cyan-700",
    "precall-plan": "bg-teal-100 text-teal-700",
    "research": "bg-emerald-100 text-emerald-700",
    "email-sequence": "bg-orange-100 text-orange-700",
    "linkedin-sequence": "bg-sky-100 text-sky-700",
    "cold-call": "bg-rose-100 text-rose-700",
    "sales-deck": "bg-violet-100 text-violet-700",
    "call-review": "bg-amber-100 text-amber-700",
    "maturity": "bg-green-100 text-green-700",
    "sales-metrics": "bg-pink-100 text-pink-700",
  };

  function formatSmartTime(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    // Today: relative times
    if (date.toDateString() === now.toDateString()) {
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
      const diffHours = Math.floor(diffMins / 60);
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    }

    // Prior days: date + time
    return date.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    }) + ", " + date.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    });
  }

  useEffect(() => {
    if (user) {
      const displayName = user.name || user.slackUserName || user.email || user.slackEmail || "User";
      document.title = `Admin - ${displayName}`;
    } else {
      document.title = "Admin - User Details";
    }
  }, [user]);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch(`/api/admin/users/${params.id}`);
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else if (res.status === 404) {
          router.push("/admin/users");
        }
      } catch (error) {
        console.error("Failed to fetch user:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, [params.id, router]);

  const updateUser = async (updates: Record<string, unknown>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "User updated successfully" });
        // Refresh user data
        const refreshRes = await fetch(`/api/admin/users/${params.id}`);
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setUser(data.user);
        }
      } else {
        const errorData = await res.json();
        setMessage({ type: "error", text: errorData.error || "Failed to update user" });
      }
    } catch (error) {
      console.error("Failed to update user:", error);
      setMessage({ type: "error", text: "Failed to update user" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading user...</div>;
  }

  if (!user) {
    return <div className="text-red-500">User not found</div>;
  }

  const displayEmail = user.email || user.slackEmail;
  const displayName = user.name || user.slackUserName;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <Link
            href="/admin/users"
            className="text-gray-500 hover:text-gray-700"
          >
            &larr; Back to Users
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {displayName || displayEmail || "Unknown User"}
          </h1>
        </div>
        <button
          onClick={handleImpersonate}
          disabled={impersonating}
          className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
        >
          {impersonating ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Logging in...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Login as User</span>
            </>
          )}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-md ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile Card */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>
            <div className="flex items-start space-x-4">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="w-16 h-16 rounded-full"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-2xl">
                  {(displayName || displayEmail || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-500">Name</label>
                    {editingName ? (
                      <div className="flex items-center space-x-2 mt-1">
                        <input
                          type="text"
                          value={nameValue}
                          onChange={(e) => setNameValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                          autoFocus
                        />
                        <button
                          onClick={async () => {
                            await updateUser({ name: nameValue });
                            setEditingName(false);
                          }}
                          disabled={saving}
                          className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingName(false)}
                          className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{displayName || "-"}</span>
                        <button
                          onClick={() => {
                            setNameValue(user.name || "");
                            setEditingName(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Email</label>
                    {editingEmail ? (
                      <div className="flex items-center space-x-2 mt-1">
                        <input
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                          autoFocus
                        />
                        <button
                          onClick={async () => {
                            await updateUser({ email: emailValue });
                            setEditingEmail(false);
                          }}
                          disabled={saving}
                          className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingEmail(false)}
                          className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{displayEmail || "-"}</span>
                        <button
                          onClick={() => {
                            setEmailValue(user.email || "");
                            setEditingEmail(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">User ID</label>
                    <div className="font-mono text-sm text-gray-600">{user.id}</div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Created</label>
                    <div>{new Date(user.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Identity Providers */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Identity Providers</h2>
            <div className="space-y-4">
              {/* Google */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">🔵</span>
                  <div>
                    <div className="font-medium">Google</div>
                    {user.googleId ? (
                      <div className="text-sm text-gray-500">
                        Connected: {user.email}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">Not connected</div>
                    )}
                  </div>
                </div>
                {user.googleId && (
                  <button
                    onClick={async () => {
                      const confirmed = await showConfirm({
                        title: "Disconnect Google",
                        message: "Disconnect Google from this user?",
                        variant: "danger",
                        confirmLabel: "Disconnect",
                      });
                      if (confirmed) updateUser({ disconnectGoogle: true });
                    }}
                    disabled={saving || !user.slackUserId}
                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                    title={!user.slackUserId ? "Cannot disconnect - user would have no identity" : ""}
                  >
                    Disconnect
                  </button>
                )}
              </div>

              {/* Slack */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">💜</span>
                  <div>
                    <div className="font-medium">Slack</div>
                    {user.slackUserId ? (
                      <div className="text-sm text-gray-500">
                        Connected: {user.slackUserName} ({user.slackEmail})
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">Not connected</div>
                    )}
                  </div>
                </div>
                {user.slackUserId && (
                  <button
                    onClick={async () => {
                      const confirmed = await showConfirm({
                        title: "Disconnect Slack",
                        message: "Disconnect Slack from this user? This will also remove workspace association.",
                        variant: "danger",
                        confirmLabel: "Disconnect",
                      });
                      if (confirmed) updateUser({ disconnectSlack: true });
                    }}
                    disabled={saving || !user.googleId}
                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                    title={!user.googleId ? "Cannot disconnect - user would have no identity" : ""}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Secondary Emails */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Secondary Emails</h2>
            <p className="text-sm text-gray-500 mb-4">
              Additional emails that can be used to log in to this account (via Google OAuth).
            </p>

            {user.secondaryEmails && user.secondaryEmails.length > 0 ? (
              <div className="space-y-2 mb-4">
                {user.secondaryEmails.map((email) => (
                  <div key={email} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium">{email}</span>
                    <button
                      onClick={async () => {
                        const confirmed = await showConfirm({
                          title: "Remove Email",
                          message: `Remove ${email} from secondary emails?`,
                          variant: "danger",
                          confirmLabel: "Remove",
                        });
                        if (confirmed) updateUser({ removeSecondaryEmail: email });
                      }}
                      disabled={saving}
                      className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-sm mb-4">No secondary emails configured</div>
            )}

            <div className="flex items-center space-x-2">
              <input
                type="email"
                value={newSecondaryEmail}
                onChange={(e) => setNewSecondaryEmail(e.target.value)}
                placeholder="Add secondary email..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <button
                onClick={async () => {
                  if (newSecondaryEmail.trim()) {
                    await updateUser({ addSecondaryEmail: newSecondaryEmail.trim() });
                    setNewSecondaryEmail("");
                  }
                }}
                disabled={saving || !newSecondaryEmail.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Merge Accounts */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Merge Accounts</h2>
            <p className="text-sm text-gray-500 mb-4">
              Merge another user&apos;s data into this account. All conversations, messages, and app data will be moved here. The source account will be deleted.
            </p>

            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={mergeUserId}
                onChange={(e) => setMergeUserId(e.target.value)}
                placeholder="User ID to merge from..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
              <button
                onClick={async () => {
                  if (!mergeUserId.trim()) return;

                  const confirmed = await showConfirm({
                    title: "Merge Accounts",
                    message: `This will:\n1. Move ALL data from user ${mergeUserId} to this user\n2. Add their email(s) to secondary emails\n3. DELETE the source user account\n\nThis action cannot be undone. Continue?`,
                    variant: "danger",
                    confirmLabel: "Merge Accounts",
                  });

                  if (confirmed) {
                    setMerging(true);
                    try {
                      await updateUser({ mergeFromUserId: mergeUserId.trim() });
                      setMergeUserId("");
                      setMessage({ type: "success", text: "Accounts merged successfully" });
                    } finally {
                      setMerging(false);
                    }
                  }
                }}
                disabled={saving || merging || !mergeUserId.trim()}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
              >
                {merging ? "Merging..." : "Merge"}
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-400">
              Tip: Find the user ID from the Users list or another user&apos;s detail page
            </div>
          </div>

          {/* Recent Conversations */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Conversations ({user.conversationCount} total)
            </h2>
            {user.conversations.length === 0 ? (
              <div className="text-gray-500">No conversations yet</div>
            ) : (
              <div className="space-y-2">
                {user.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleImpersonateToLink(`/chat/${conv.id}`)}
                    disabled={impersonating}
                    className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm truncate flex-1 mr-3">
                        {conv.title || conv.firstMessagePreview?.slice(0, 50) || "Untitled"}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {conv.source === "SLACK" && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            Slack
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {conv.messageCount} msgs
                        </span>
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatSmartTime(conv.lastMessageAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* App Activity */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              App Activity
            </h2>
            {user.activity.length === 0 ? (
              <div className="text-gray-500">No app activity yet</div>
            ) : (
              <div className="space-y-2">
                {user.activity.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => handleImpersonateToLink(item.link)}
                    disabled={impersonating}
                    className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded flex-shrink-0 ${activityTypeColors[item.type] || "bg-gray-100 text-gray-700"}`}>
                        {item.label}
                      </span>
                      <span className="text-sm text-gray-700 truncate flex-1 min-w-0">
                        {item.title || ""}
                      </span>
                      <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatSmartTime(item.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* License Status */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">License</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-500">Status</label>
                <div className="mt-1">
                  <select
                    value={user.licenseStatus}
                    onChange={(e) => updateUser({ licenseStatus: e.target.value })}
                    disabled={saving}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="TRIAL">Trial</option>
                    <option value="ACTIVE">Active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                </div>
              </div>

              {user.licenseStatus === "TRIAL" && (
                <>
                  <div>
                    <label className="text-sm text-gray-500">Trial Started</label>
                    <div className="font-medium">
                      {user.trialStartedAt
                        ? new Date(user.trialStartedAt).toLocaleDateString()
                        : "Not started"}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Days Remaining</label>
                    <div className="font-medium">
                      {user.trialDaysRemaining !== null
                        ? `${user.trialDaysRemaining} days`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Extend Trial</label>
                    <div className="flex space-x-2 mt-1">
                      {[7, 14, 30].map((days) => (
                        <button
                          key={days}
                          onClick={() => updateUser({ extendTrialDays: days })}
                          disabled={saving}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                        >
                          +{days}d
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {user.license && (
                <div className="pt-4 border-t border-gray-200">
                  <label className="text-sm text-gray-500">License Details</label>
                  <div className="mt-1 text-sm">
                    <div>Type: {user.license.type}</div>
                    <div>Status: {user.license.status}</div>
                    {user.license.expiresAt && (
                      <div>
                        Expires: {new Date(user.license.expiresAt).toLocaleDateString()}
                      </div>
                    )}
                    {user.license.stripeSubscriptionId && (
                      <div className="mt-2">
                        <a
                          href={`https://dashboard.stripe.com/subscriptions/${user.license.stripeSubscriptionId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          View in Stripe &rarr;
                        </a>
                      </div>
                    )}
                    {user.license.manuallyGranted && (
                      <div className="mt-2 text-yellow-600">
                        Manually granted
                        {user.license.notes && (
                          <div className="text-gray-500">{user.license.notes}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Workspace */}
          {user.workspace && (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspace</h2>
              <div className="space-y-2">
                <div>
                  <label className="text-sm text-gray-500">Name</label>
                  <div className="font-medium">{user.workspace.slackTeamName}</div>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Team ID</label>
                  <div className="font-mono text-sm">{user.workspace.slackTeamId}</div>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Installed</label>
                  <div>{new Date(user.workspace.installedAt).toLocaleDateString()}</div>
                </div>
                <div className="pt-2">
                  <Link
                    href={`/admin/workspaces/${user.workspace.id}`}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    View Workspace &rarr;
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Stats</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">Conversations</span>
                <span className="font-medium">{user.conversationCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Messages</span>
                <span className="font-medium">{user.messageCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Messages Today</span>
                <span className="font-medium">{user.messagesToday}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Referrals Made</span>
                <span className="font-medium">{user.referralCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Bonus Messages</span>
                <span className="font-medium">{user.bonusMessagesEarned}</span>
              </div>
            </div>
          </div>

          {/* Referral Code */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Referral</h2>
            <div>
              <label className="text-sm text-gray-500">Referral Code</label>
              <div className="font-mono text-sm bg-gray-100 p-2 rounded mt-1">
                {user.referralCode}
              </div>
            </div>
          </div>

          {/* Prompt Settings */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Prompt Settings</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Dismissed Defaults</span>
                <span className="font-medium">{user.dismissedDefaultPromptIds?.length || 0}</span>
              </div>
              {user.dismissedDefaultPromptIds?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    This user has dismissed {user.dismissedDefaultPromptIds.length} default prompt(s).
                    Reset to allow them to reappear.
                  </p>
                  <button
                    onClick={async () => {
                      const confirmed = await showConfirm({
                        title: "Reset Default Prompts",
                        message: "Reset dismissed default prompts? The user will see all default prompts again on their next visit.",
                        variant: "warning",
                        confirmLabel: "Reset",
                      });
                      if (confirmed) updateUser({ resetDefaultPrompts: true });
                    }}
                    disabled={saving}
                    className="w-full px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                  >
                    Reset Default Prompts
                  </button>
                </div>
              )}
              {(!user.dismissedDefaultPromptIds || user.dismissedDefaultPromptIds.length === 0) && (
                <p className="text-xs text-gray-500">
                  No default prompts have been dismissed.
                </p>
              )}
            </div>
          </div>

          {/* Sessions */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Sessions</h2>
            {user.sessions.length === 0 ? (
              <div className="text-gray-500 text-sm">No active sessions</div>
            ) : (
              <div className="space-y-2">
                {user.sessions.map((session) => (
                  <div key={session.id} className="text-sm">
                    <div className="text-gray-600">
                      {new Date(session.createdAt).toLocaleString()}
                    </div>
                    <div className="text-gray-400 text-xs">
                      Expires: {new Date(session.expiresAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {ConfirmModalElement}
    </div>
  );
}
