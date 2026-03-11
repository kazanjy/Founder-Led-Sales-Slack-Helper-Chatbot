"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

interface ActivityItem {
  id: string;
  type: string;
  label: string;
  title: string | null;
  link: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  workspaceName: string | null;
  createdAt: string;
}

interface CompletionUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  licenseStatus: string;
  workspaceName: string | null;
  createdAt: string;
  completion: {
    slackConnected: boolean;
    narrative: boolean;
    discoveryQuestions: boolean;
    firstCallChecklist: boolean;
    preCallPlan: boolean;
    researchReport: boolean;
    callReview: boolean;
    callScript: boolean;
    salesDeck: boolean;
    emailSequence: boolean;
    linkedInSequence: boolean;
    salesMetrics: boolean;
  };
  completionCount: number;
  completionTotal: number;
}

const COMPLETION_KEYS: { key: keyof CompletionUser["completion"]; label: string; short: string }[] = [
  { key: "slackConnected", label: "Slack Connected", short: "Slack" },
  { key: "narrative", label: "Narrative", short: "Narr" },
  { key: "discoveryQuestions", label: "Discovery Questions", short: "Disc" },
  { key: "firstCallChecklist", label: "First Call Checklist", short: "1st Call" },
  { key: "preCallPlan", label: "Pre-Call Plan", short: "Plan" },
  { key: "researchReport", label: "Research Report", short: "Research" },
  { key: "callReview", label: "Call Review", short: "Review" },
  { key: "callScript", label: "Call Script", short: "Script" },
  { key: "salesDeck", label: "Sales Deck", short: "Deck" },
  { key: "emailSequence", label: "Email Sequence", short: "Email" },
  { key: "linkedInSequence", label: "LinkedIn Sequence", short: "LI" },
  { key: "salesMetrics", label: "Sales Metrics", short: "Metrics" },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<string>("all");
  const [feedSearch, setFeedSearch] = useState("");
  const [completionUsers, setCompletionUsers] = useState<CompletionUser[]>([]);
  const [completionLoading, setCompletionLoading] = useState(true);
  const [completionFilter, setCompletionFilter] = useState<string>("all");
  const [completionSearch, setCompletionSearch] = useState("");

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

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch("/api/admin/activity");
        if (res.ok) {
          const data = await res.json();
          setActivity(data.activity);
        }
      } catch (error) {
        console.error("Failed to fetch activity:", error);
      } finally {
        setActivityLoading(false);
      }
    }
    fetchActivity();
  }, []);

  useEffect(() => {
    async function fetchCompletion() {
      try {
        const res = await fetch("/api/admin/users/completion");
        if (res.ok) {
          const data = await res.json();
          setCompletionUsers(data.users);
        }
      } catch (error) {
        console.error("Failed to fetch completion:", error);
      } finally {
        setCompletionLoading(false);
      }
    }
    fetchCompletion();
  }, []);

  // Filter completion users
  const filteredCompletionUsers = completionUsers.filter((u) => {
    // Search filter
    if (completionSearch) {
      const q = completionSearch.toLowerCase();
      const matches =
        (u.name?.toLowerCase() || "").includes(q) ||
        (u.email?.toLowerCase() || "").includes(q) ||
        (u.workspaceName?.toLowerCase() || "").includes(q);
      if (!matches) return false;
    }
    // Completion filter
    if (completionFilter === "all") return true;
    if (completionFilter === "complete") return u.completionCount === u.completionTotal;
    if (completionFilter === "incomplete") return u.completionCount < u.completionTotal;
    if (completionFilter === "none") return u.completionCount === 0;
    // Filter by specific key
    const key = completionFilter as keyof CompletionUser["completion"];
    if (key in (completionUsers[0]?.completion ?? {})) {
      return u.completion[key];
    }
    // "missing-{key}" filter
    if (completionFilter.startsWith("missing-")) {
      const missingKey = completionFilter.replace("missing-", "") as keyof CompletionUser["completion"];
      return !u.completion[missingKey];
    }
    return true;
  });

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
        window.open(data.redirectTo, "_blank");
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
    } finally {
      setImpersonatingId(null);
    }
  }

  async function handleImpersonateToLink(userId: string, link: string) {
    if (impersonatingId) return;
    setImpersonatingId(userId);
    try {
      const res = await fetch(
        `/api/admin/users/${userId}/impersonate?redirectTo=${encodeURIComponent(link)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok && data.redirectTo) {
        window.open(data.redirectTo, "_blank");
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
    } finally {
      setImpersonatingId(null);
    }
  }

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

  function formatTimeAgo(dateStr: string): string {
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

      {/* Unified Activity Feed */}
      <div className="bg-white rounded-lg shadow border border-gray-200 mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          <p className="text-sm text-gray-500 mt-1">Click row to open in new tab, or click name for admin profile</p>
        </div>
        {convsLoading && activityLoading ? (
          <div className="p-6 text-gray-500">Loading activity...</div>
        ) : (() => {
          // Build unified feed items
          type FeedItem = {
            key: string;
            filterType: string;
            sortTime: string;
            searchText: string;
            render: React.ReactNode;
          };
          const feedItems: FeedItem[] = [];

          // Conversations
          for (const conv of conversations) {
            const filterType = conv.source === "SLACK" ? "chat-slack" : "chat-web";
            const userName = getUserDisplayName(conv.user);
            feedItems.push({
              key: `conv-${conv.id}`,
              filterType,
              sortTime: conv.lastMessageAt,
              searchText: `${userName} ${conv.user.email || ""} ${conv.title || ""} ${conv.firstMessagePreview || ""} ${conv.user.workspace?.slackTeamName || ""}`.toLowerCase(),
              render: (
                <button
                  key={`conv-${conv.id}`}
                  onClick={() => handleImpersonateToChat(conv.user.id, conv.id)}
                  disabled={impersonatingId !== null}
                  className="w-full text-left px-6 py-4 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="flex items-start gap-3">
                    <Link
                      href={`/admin/users/${conv.user.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0"
                    >
                      {conv.user.avatarUrl ? (
                        <img src={conv.user.avatarUrl} alt="" className="w-9 h-9 rounded-full hover:ring-2 hover:ring-blue-400" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium hover:ring-2 hover:ring-blue-400">
                          {userName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/users/${conv.user.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-blue-600 truncate hover:text-blue-800 hover:underline"
                        >
                          {userName}
                        </Link>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${conv.source === "SLACK" ? "bg-purple-100 text-purple-700" : "bg-gray-200 text-gray-700"}`}>
                          {conv.source === "SLACK" ? "Slack Chat" : "Web Chat"}
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
                        {conv.user.email && <span className="ml-2">{conv.user.email}</span>}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-gray-300 self-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ),
            });
          }

          // App activity
          for (const item of activity) {
            const actUserName = item.userName || "Unknown";
            feedItems.push({
              key: `act-${item.type}-${item.id}`,
              filterType: item.type,
              sortTime: item.createdAt,
              searchText: `${item.userName || ""} ${item.userEmail || ""} ${item.title || ""} ${item.label} ${item.workspaceName || ""}`.toLowerCase(),
              render: (
                <button
                  key={`act-${item.type}-${item.id}`}
                  onClick={() => handleImpersonateToLink(item.userId, item.link)}
                  disabled={impersonatingId !== null}
                  className="w-full text-left px-6 py-4 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="flex items-start gap-3">
                    <Link
                      href={`/admin/users/${item.userId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0"
                    >
                      {item.userAvatarUrl ? (
                        <img src={item.userAvatarUrl} alt="" className="w-9 h-9 rounded-full hover:ring-2 hover:ring-blue-400" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium hover:ring-2 hover:ring-blue-400">
                          {actUserName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/users/${item.userId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-blue-600 truncate hover:text-blue-800 hover:underline"
                        >
                          {actUserName}
                        </Link>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${activityTypeColors[item.type] || "bg-gray-100 text-gray-700"}`}>
                          {item.label}
                        </span>
                        {item.workspaceName && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                            {item.workspaceName}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 flex-shrink-0 ml-auto">
                          {formatTimeAgo(item.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 truncate mt-0.5">
                        {item.title || ""}
                      </div>
                      {item.userEmail && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {item.userEmail}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-gray-300 self-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ),
            });
          }

          // Sort by time descending
          feedItems.sort((a, b) => new Date(b.sortTime).getTime() - new Date(a.sortTime).getTime());

          // Collect present types for filter chips
          const presentTypes = new Set(feedItems.map((f) => f.filterType));

          const filterOptions: { key: string; label: string }[] = [
            { key: "all", label: "All" },
          ];
          if (presentTypes.has("chat-web") || presentTypes.has("chat-slack")) {
            filterOptions.push({ key: "chats", label: "Chats" });
          }
          if (presentTypes.has("chat-web")) filterOptions.push({ key: "chat-web", label: "Web Chats" });
          if (presentTypes.has("chat-slack")) filterOptions.push({ key: "chat-slack", label: "Slack Chats" });

          const activityTypeLabels: Record<string, string> = {
            "narrative": "Narratives",
            "discovery": "Discovery Qs",
            "checklist": "Checklists",
            "precall-plan": "Pre-Call Plans",
            "research": "Research",
            "email-sequence": "Email Sequences",
            "linkedin-sequence": "LinkedIn Sequences",
            "cold-call": "Call Scripts",
            "sales-deck": "Sales Decks",
            "call-review": "Call Reviews",
            "maturity": "GTM Assessments",
            "sales-metrics": "Sales Metrics",
          };

          for (const [key, label] of Object.entries(activityTypeLabels)) {
            if (presentTypes.has(key)) {
              filterOptions.push({ key, label });
            }
          }

          // Apply type filter
          const typeFiltered = feedFilter === "all"
            ? feedItems
            : feedFilter === "chats"
              ? feedItems.filter((f) => f.filterType === "chat-web" || f.filterType === "chat-slack")
              : feedItems.filter((f) => f.filterType === feedFilter);

          // Apply search filter
          const searchLower = feedSearch.toLowerCase().trim();
          const filteredItems = searchLower
            ? typeFiltered.filter((f) => f.searchText.includes(searchLower))
            : typeFiltered;

          const countForFilter = (key: string) =>
            key === "all"
              ? feedItems.length
              : key === "chats"
                ? feedItems.filter((f) => f.filterType === "chat-web" || f.filterType === "chat-slack").length
                : feedItems.filter((f) => f.filterType === key).length;

          return (
            <div>
              {/* Search + Filter chips */}
              <div className="p-4 border-b border-gray-100 space-y-3">
                <input
                  type="text"
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  placeholder="Search by name, email, title, workspace..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400"
                />
                <div className="flex flex-wrap gap-1.5">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setFeedFilter(opt.key)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        feedFilter === opt.key
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {opt.label}
                      <span className="ml-1 opacity-70">{countForFilter(opt.key)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="p-6 text-gray-500 text-center">
                  {feedSearch ? "No results matching your search" : "No activity yet"}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredItems.map((item) => (
                    <div key={item.key}>{item.render}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* User Completion Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200 mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Feature Completion by User</h2>
          <p className="text-sm text-gray-500">Track which features each user has completed. Click a column header to filter.</p>
        </div>
        <div className="p-4 border-b border-gray-200 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by name, email, or workspace..."
            value={completionSearch}
            onChange={(e) => setCompletionSearch(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "all", label: "All" },
              { value: "complete", label: "100%" },
              { value: "incomplete", label: "Incomplete" },
              { value: "none", label: "0%" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setCompletionFilter(f.value)}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                  completionFilter === f.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {completionLoading ? (
          <div className="p-8 text-center text-gray-400">Loading completion data...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[200px]">User</th>
                  <th className="px-2 py-3 font-medium text-gray-600 text-center min-w-[50px]">Score</th>
                  {COMPLETION_KEYS.map((ck) => (
                    <th
                      key={ck.key}
                      className="px-2 py-3 font-medium text-gray-500 text-center min-w-[60px] cursor-pointer hover:text-blue-600"
                      title={`Filter: has ${ck.label}`}
                      onClick={() =>
                        setCompletionFilter(
                          completionFilter === ck.key ? `missing-${ck.key}` :
                          completionFilter === `missing-${ck.key}` ? "all" :
                          ck.key
                        )
                      }
                    >
                      <span className={`text-xs ${
                        completionFilter === ck.key
                          ? "text-green-600 underline"
                          : completionFilter === `missing-${ck.key}`
                          ? "text-red-600 underline"
                          : ""
                      }`}>
                        {ck.short}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCompletionUsers.length === 0 ? (
                  <tr>
                    <td colSpan={2 + COMPLETION_KEYS.length} className="px-4 py-8 text-center text-gray-400">
                      No users match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredCompletionUsers.map((u) => (
                    <tr key={u.id} className="border-b border-gray-100 hover:bg-blue-50/50">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="flex items-center gap-2 group"
                        >
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-medium">
                              {(u.name || u.email || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-blue-600 font-medium truncate group-hover:underline text-sm">
                              {u.name || u.email || "Unknown"}
                            </div>
                            {u.name && u.email && (
                              <div className="text-xs text-gray-400 truncate">{u.email}</div>
                            )}
                          </div>
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                          u.completionCount === u.completionTotal
                            ? "bg-green-100 text-green-700"
                            : u.completionCount >= u.completionTotal / 2
                            ? "bg-yellow-100 text-yellow-700"
                            : u.completionCount > 0
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {u.completionCount}/{u.completionTotal}
                        </span>
                      </td>
                      {COMPLETION_KEYS.map((ck) => (
                        <td key={ck.key} className="px-2 py-2.5 text-center">
                          {u.completion[ck.key] ? (
                            <span className="text-green-500" title={ck.label}>&#10003;</span>
                          ) : (
                            <span className="text-gray-200">&mdash;</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {!completionLoading && filteredCompletionUsers.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-400">
            Showing {filteredCompletionUsers.length} of {completionUsers.length} users
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
