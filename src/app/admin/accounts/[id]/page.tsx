"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface AccountUser {
  id: string;
  name: string | null;
  email: string | null;
  slackUserName: string | null;
  slackUserId: string | null;
  avatarUrl: string | null;
  accountRole: string;
  licenseStatus: string;
  _count: { conversations: number; messages: number };
  workspaceId: string | null;
  workspace: { id: string; slackTeamName: string } | null;
  createdAt: string;
}

interface ChannelClaim {
  id: string;
  slackChannelId: string;
  slackChannelName: string | null;
  workspaceId: string;
  workspace: { id: string; slackTeamName: string };
  claimedBy: {
    id: string;
    name: string | null;
    email: string | null;
    slackUserName: string | null;
  };
  createdAt: string;
}

interface AccountDetail {
  id: string;
  name: string;
  emailDomain: string | null;
  createdAt: string;
  updatedAt: string;
  users: AccountUser[];
  channelClaims: ChannelClaim[];
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
  createdAt: string;
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
  "ad-creator": "bg-rose-100 text-rose-700",
};

function formatTimeAgo(dateStr: string): string {
  const tz = "America/Los_Angeles";
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  const nowPT = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const datePT = new Date(date.toLocaleString("en-US", { timeZone: tz }));

  const todayPT = new Date(nowPT.getFullYear(), nowPT.getMonth(), nowPT.getDate());
  const dateDayPT = new Date(datePT.getFullYear(), datePT.getMonth(), datePT.getDate());
  const yesterdayPT = new Date(todayPT);
  yesterdayPT.setDate(yesterdayPT.getDate() - 1);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: tz,
  });

  if (dateDayPT.getTime() === todayPT.getTime()) {
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  }

  if (dateDayPT.getTime() === yesterdayPT.getTime()) {
    return `Yesterday, ${timeStr}`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: tz,
  }) + ", " + timeStr;
}

export default function AdminAccountDetailPage() {
  const params = useParams();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedFilter, setFeedFilter] = useState<string>("all");
  const [feedSearch, setFeedSearch] = useState("");

  // Add user form state
  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserSearch, setAddUserSearch] = useState("");
  const [addUserResults, setAddUserResults] = useState<{ id: string; name: string | null; email: string | null; slackUserName: string | null }[]>([]);
  const [addUserSearching, setAddUserSearching] = useState(false);
  const [addUserRole, setAddUserRole] = useState("MEMBER");
  const [addUserError, setAddUserError] = useState("");

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/accounts/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setAccount(data.account);
        setActivity(data.activity || []);
      }
    } catch (error) {
      console.error("Failed to fetch account:", error);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const searchUsers = async (query: string) => {
    if (query.length < 2) {
      setAddUserResults([]);
      return;
    }
    setAddUserSearching(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        // Filter out users already in this account
        const existingIds = new Set(account?.users.map((u) => u.id) || []);
        setAddUserResults(
          (data.users || []).filter((u: { id: string }) => !existingIds.has(u.id))
        );
      }
    } catch {
      // ignore
    } finally {
      setAddUserSearching(false);
    }
  };

  const handleAddUser = async (userId: string) => {
    setAddUserError("");
    try {
      const res = await fetch(`/api/admin/accounts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addUserId: userId, role: addUserRole }),
      });
      if (res.ok) {
        setShowAddUser(false);
        setAddUserSearch("");
        setAddUserResults([]);
        setAddUserRole("MEMBER");
        fetchAccount();
      } else {
        const data = await res.json();
        setAddUserError(data.error || "Failed to add user");
      }
    } catch {
      setAddUserError("Network error");
    }
  };

  const handleRemoveUser = async (userId: string) => {
    if (!confirm("Remove this user from the account?")) return;
    try {
      const res = await fetch(`/api/admin/accounts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeUserId: userId }),
      });
      if (res.ok) {
        fetchAccount();
      }
    } catch (error) {
      console.error("Failed to remove user:", error);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/accounts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updateUserRole: newRole }),
      });
      if (res.ok) {
        fetchAccount();
      }
    } catch (error) {
      console.error("Failed to update role:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading account...</div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="text-center py-12">
        <div className="text-red-500 mb-4">Account not found</div>
        <Link href="/admin/accounts" className="text-blue-600 hover:underline">
          Back to Accounts
        </Link>
      </div>
    );
  }

  const owner = account.users.find((u) => u.accountRole === "OWNER");

  // Build activity feed filter options
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
    "ad-creator": "Ad Concepts",
  };

  const presentTypes = new Set(activity.map((a) => a.type));
  const filterOptions: { key: string; label: string }[] = [{ key: "all", label: "All" }];
  for (const [key, label] of Object.entries(activityTypeLabels)) {
    if (presentTypes.has(key)) {
      filterOptions.push({ key, label });
    }
  }

  const filteredActivity = activity
    .filter((item) => {
      if (feedFilter !== "all" && item.type !== feedFilter) return false;
      if (feedSearch) {
        const q = feedSearch.toLowerCase();
        const searchText = `${item.userName || ""} ${item.userEmail || ""} ${item.title || ""} ${item.label}`.toLowerCase();
        if (!searchText.includes(q)) return false;
      }
      return true;
    });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/admin/accounts" className="text-sm text-blue-600 hover:underline">
          Accounts
        </Link>
        <span className="text-sm text-gray-400 mx-2">/</span>
        <span className="text-sm text-gray-600">{account.name}</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">{account.name}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Account details + Users */}
        <div className="lg:col-span-1 space-y-6">
          {/* Account Details */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-500">Name</label>
                <div className="font-medium">{account.name}</div>
              </div>
              {account.emailDomain && (
                <div>
                  <label className="text-sm text-gray-500">Email Domain</label>
                  <div className="font-mono text-sm">{account.emailDomain}</div>
                </div>
              )}
              <div>
                <label className="text-sm text-gray-500">Owner</label>
                <div>
                  {owner ? (
                    <Link href={`/admin/users/${owner.id}`} className="text-blue-600 hover:underline">
                      {owner.name || owner.email || owner.slackUserName || owner.id}
                    </Link>
                  ) : (
                    <span className="text-gray-400 italic">No owner</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Users</label>
                <div>{account.users.length}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Channels Claimed</label>
                <div>{account.channelClaims.length}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Created</label>
                <div>{new Date(account.createdAt).toLocaleDateString()}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Account ID</label>
                <div className="font-mono text-xs break-all text-gray-600">{account.id}</div>
              </div>
            </div>
          </div>

          {/* Users */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Members ({account.users.length})
              </h2>
              <button
                onClick={() => {
                  setShowAddUser(!showAddUser);
                  setAddUserError("");
                  setAddUserSearch("");
                  setAddUserResults([]);
                }}
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                + Add User
              </button>
            </div>

            {/* Add user form */}
            {showAddUser && (
              <div className="bg-gray-50 rounded-md p-3 mb-4 border border-gray-200 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Search users by name or email
                  </label>
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={addUserSearch}
                    onChange={(e) => {
                      setAddUserSearch(e.target.value);
                      searchUsers(e.target.value);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                  <select
                    value={addUserRole}
                    onChange={(e) => setAddUserRole(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                    <option value="OWNER">Owner</option>
                  </select>
                </div>
                {addUserSearching && (
                  <div className="text-xs text-gray-500">Searching...</div>
                )}
                {addUserResults.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {addUserResults.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between bg-white rounded px-2 py-1.5 border border-gray-100 text-sm"
                      >
                        <span className="truncate">
                          {u.name || u.email || u.slackUserName || u.id}
                          {u.email && u.name && (
                            <span className="text-gray-400 text-xs ml-1">({u.email})</span>
                          )}
                        </span>
                        <button
                          onClick={() => handleAddUser(u.id)}
                          className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 ml-2 shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {addUserSearch.length >= 2 && !addUserSearching && addUserResults.length === 0 && (
                  <div className="text-xs text-gray-400 italic">No users found</div>
                )}
                {addUserError && (
                  <div className="text-red-600 text-xs">{addUserError}</div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {account.users.map((user) => (
                <div key={user.id} className="flex items-start gap-3 group">
                  <Link href={`/admin/users/${user.id}`} className="flex-shrink-0">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-9 h-9 rounded-full hover:ring-2 hover:ring-blue-400" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium hover:ring-2 hover:ring-blue-400">
                        {(user.name || user.email || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="font-medium text-blue-600 hover:underline text-sm truncate"
                      >
                        {user.name || user.email || user.slackUserName || user.id}
                      </Link>
                      <select
                        value={user.accountRole}
                        onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                        className={`text-xs font-medium px-1.5 py-0.5 rounded border-0 cursor-pointer ${
                          user.accountRole === "OWNER"
                            ? "bg-purple-100 text-purple-700"
                            : user.accountRole === "ADMIN"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        <option value="OWNER">OWNER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="MEMBER">MEMBER</option>
                      </select>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {user.email && <span>{user.email}</span>}
                      {user.workspace && (
                        <span className="ml-2 text-gray-400">
                          {user.workspace.slackTeamName}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      <span className={`inline-block px-1 py-0 rounded ${
                        user.licenseStatus === "ACTIVE" ? "bg-green-100 text-green-700" :
                        user.licenseStatus === "TRIAL" ? "bg-yellow-100 text-yellow-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {user.licenseStatus}
                      </span>
                      <span className="ml-2">{user._count.conversations} convos</span>
                      <span className="ml-1">{user._count.messages} msgs</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveUser(user.id)}
                    className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
                    title="Remove from account"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Channel Claims */}
          {account.channelClaims.length > 0 && (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Claimed Channels ({account.channelClaims.length})
              </h2>
              <div className="space-y-2">
                {account.channelClaims.map((claim) => (
                  <div key={claim.id} className="bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-900">
                        {claim.slackChannelName || claim.slackChannelId}
                      </span>
                      {claim.slackChannelName && (
                        <span className="text-xs text-gray-400 font-mono">
                          {claim.slackChannelId}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Owned by{" "}
                      <Link href={`/admin/users/${claim.claimedBy.id}`} className="text-blue-600 hover:underline">
                        {claim.claimedBy.name || claim.claimedBy.email || claim.claimedBy.slackUserName}
                      </Link>
                      {" in "}{claim.workspace.slackTeamName}
                      {" · "}{new Date(claim.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Activity Feed */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <div className="px-4 py-4 sm:px-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Activity Feed</h2>
                <input
                  type="text"
                  placeholder="Search activity..."
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm w-48"
                />
              </div>
              {filterOptions.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setFeedFilter(opt.key)}
                      className={`text-xs px-2 py-1 rounded-full transition-colors ${
                        feedFilter === opt.key
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {filteredActivity.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400">
                  {activity.length === 0 ? "No activity yet" : "No matching activity"}
                </div>
              ) : (
                filteredActivity.map((item) => {
                  const actUserName = item.userName || "Unknown";
                  return (
                    <div
                      key={`${item.type}-${item.id}`}
                      className="px-4 py-3 sm:px-6 sm:py-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-2 sm:gap-3">
                        <Link
                          href={`/admin/users/${item.userId}`}
                          className="flex-shrink-0"
                        >
                          {item.userAvatarUrl ? (
                            <img src={item.userAvatarUrl} alt="" className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:ring-2 hover:ring-blue-400" />
                          ) : (
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium hover:ring-2 hover:ring-blue-400">
                              {actUserName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <Link
                              href={`/admin/users/${item.userId}`}
                              className="font-medium text-blue-600 truncate hover:text-blue-800 hover:underline text-sm sm:text-base"
                            >
                              {actUserName}
                            </Link>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${activityTypeColors[item.type] || "bg-gray-100 text-gray-700"}`}>
                              {item.label}
                            </span>
                          </div>
                          {item.title && (
                            <div className="text-sm text-gray-700 truncate mt-0.5">
                              {item.title}
                            </div>
                          )}
                          <div className="text-xs text-gray-400 mt-0.5">
                            <span className="sm:hidden">{formatTimeAgo(item.createdAt)}</span>
                            {item.userEmail && <span className="hidden sm:inline">{item.userEmail}</span>}
                          </div>
                        </div>
                        <div className="flex-shrink-0 self-center text-right ml-2 sm:ml-3 hidden sm:block">
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {formatTimeAgo(item.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
