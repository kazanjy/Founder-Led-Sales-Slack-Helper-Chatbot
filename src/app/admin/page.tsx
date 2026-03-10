"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Stats {
  totalUsers: number;
  trialUsers: number;
  activeUsers: number;
  expiredUsers: number;
  totalWorkspaces: number;
  totalConversations: number;
  totalMessages: number;
  recentUsers: number;
  googleUsers: number;
  slackUsers: number;
}

interface RecentConversation {
  id: string;
  title: string | null;
  firstMessagePreview: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  source: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    slackUserName: string | null;
    avatarUrl: string | null;
    workspace: {
      slackTeamName: string;
    } | null;
  };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin - Dashboard";
  }, []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/admin/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats);
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  useEffect(() => {
    async function fetchConversations() {
      try {
        const res = await fetch("/api/admin/recent-conversations");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations);
        }
      } catch (error) {
        console.error("Failed to fetch recent conversations:", error);
      } finally {
        setConvsLoading(false);
      }
    }
    fetchConversations();
  }, []);

  async function handleImpersonateToChat(userId: string, conversationId: string) {
    if (impersonatingId) return;
    setImpersonatingId(userId);
    try {
      const redirectTo = `/chat/${conversationId}`;
      const res = await fetch(
        `/api/admin/users/${userId}/impersonate?redirectTo=${encodeURIComponent(redirectTo)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok && data.redirectTo) {
        router.push(data.redirectTo);
      } else {
        setImpersonatingId(null);
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
      setImpersonatingId(null);
    }
  }

  function formatTimeAgo(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function getUserDisplayName(user: RecentConversation["user"]): string {
    return user.name || user.slackUserName || user.email || "Unknown";
  }

  if (loading) {
    return <div className="text-gray-500">Loading stats...</div>;
  }

  if (!stats) {
    return <div className="text-red-500">Failed to load stats</div>;
  }

  const statCards = [
    {
      label: "Total Users",
      value: stats.totalUsers,
      icon: "👥",
      href: "/admin/users",
    },
    {
      label: "Active Licenses",
      value: stats.activeUsers,
      icon: "✅",
      href: "/admin/users?status=ACTIVE",
      color: "text-green-600",
    },
    {
      label: "In Trial",
      value: stats.trialUsers,
      icon: "⏳",
      href: "/admin/users?status=TRIAL",
      color: "text-yellow-600",
    },
    {
      label: "Expired/Suspended",
      value: stats.expiredUsers,
      icon: "⚠️",
      href: "/admin/users?status=EXPIRED",
      color: "text-red-600",
    },
    {
      label: "Workspaces",
      value: stats.totalWorkspaces,
      icon: "🏢",
      href: "/admin/workspaces",
    },
    {
      label: "Conversations",
      value: stats.totalConversations,
      icon: "💬",
    },
    {
      label: "Total Messages",
      value: stats.totalMessages,
      icon: "📝",
    },
    {
      label: "New Users (7 days)",
      value: stats.recentUsers,
      icon: "🆕",
      color: "text-blue-600",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-lg shadow p-4 border border-gray-200"
          >
            {stat.href ? (
              <Link href={stat.href} className="block hover:bg-gray-50 -m-4 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{stat.icon}</span>
                </div>
                <div className={`text-3xl font-bold mt-2 ${stat.color || "text-gray-900"}`}>
                  {stat.value.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </Link>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{stat.icon}</span>
                </div>
                <div className={`text-3xl font-bold mt-2 ${stat.color || "text-gray-900"}`}>
                  {stat.value.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Recent Conversations */}
      <div className="bg-white rounded-lg shadow border border-gray-200 mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Conversations</h2>
          <p className="text-sm text-gray-500 mt-1">Click to impersonate user and enter their chat</p>
        </div>
        {convsLoading ? (
          <div className="p-6 text-gray-500">Loading recent conversations...</div>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-gray-500">No conversations yet</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => handleImpersonateToChat(conv.user.id, conv.id)}
                disabled={impersonatingId !== null}
                className="w-full text-left px-6 py-4 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {conv.user.avatarUrl ? (
                      <img
                        src={conv.user.avatarUrl}
                        alt=""
                        className="w-9 h-9 rounded-full"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                        {getUserDisplayName(conv.user).charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">
                        {getUserDisplayName(conv.user)}
                      </span>
                      {conv.user.workspace?.slackTeamName && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                          {conv.user.workspace.slackTeamName}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-auto">
                        {formatTimeAgo(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700 truncate mt-0.5">
                      {conv.title || conv.firstMessagePreview || "New conversation"}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {conv.messageCount} message{conv.messageCount !== 1 ? "s" : ""}
                      {conv.user.email && (
                        <span className="ml-2">{conv.user.email}</span>
                      )}
                    </div>
                  </div>

                  {/* Arrow indicator */}
                  <div className="flex-shrink-0 text-gray-300 self-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Identity Breakdown */}
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">User Identity Types</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-xl">🔵</span>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{stats.googleUsers}</div>
              <div className="text-sm text-gray-500">Google Users</div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-xl">💜</span>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{stats.slackUsers}</div>
              <div className="text-sm text-gray-500">Slack Users</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/users"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            View All Users
          </Link>
          <Link
            href="/admin/users?status=TRIAL"
            className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600"
          >
            View Trial Users
          </Link>
          <Link
            href="/admin/workspaces"
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            View Workspaces
          </Link>
        </div>
      </div>
    </div>
  );
}
