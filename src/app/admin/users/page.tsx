"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  licenseStatus: string;
  trialStartedAt: string | null;
  createdAt: string;
  hasGoogle: boolean;
  hasSlack: boolean;
  workspace: { id: string; name: string } | null;
  license: { id: string; status: string; hasStripe: boolean } | null;
  conversationCount: number;
  messageCount: number;
  lastActivity: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [identityType, setIdentityType] = useState(searchParams.get("identityType") || "");

  const currentPage = parseInt(searchParams.get("page") || "1");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (identityType) params.set("identityType", identityType);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, status, identityType]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const updateUrl = (newParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Reset to page 1 when filters change
    if (!("page" in newParams)) {
      params.set("page", "1");
    }
    router.push(`/admin/users?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrl({ search });
  };

  const getLicenseStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      TRIAL: "bg-yellow-100 text-yellow-800",
      ACTIVE: "bg-green-100 text-green-800",
      EXPIRED: "bg-red-100 text-red-800",
      SUSPENDED: "bg-gray-100 text-gray-800",
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || "bg-gray-100"}`}>
        {status}
      </span>
    );
  };

  const getIdentityIcons = (user: User) => {
    return (
      <div className="flex space-x-1">
        {user.hasGoogle && (
          <span title="Google connected" className="text-sm">🔵</span>
        )}
        {user.hasSlack && (
          <span title="Slack connected" className="text-sm">💜</span>
        )}
      </div>
    );
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        {pagination && (
          <span className="text-sm text-gray-500">
            {pagination.total.toLocaleString()} total users
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200 mb-6">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <div className="flex">
              <input
                type="text"
                placeholder="Search by email or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-r-md hover:bg-blue-700"
              >
                Search
              </button>
            </div>
          </form>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => updateUrl({ status: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="TRIAL">Trial</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="SUSPENDED">Suspended</option>
          </select>

          {/* Identity filter */}
          <select
            value={identityType}
            onChange={(e) => updateUrl({ identityType: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Identity Types</option>
            <option value="google">Google Only</option>
            <option value="slack">Slack Only</option>
            <option value="both">Both Connected</option>
          </select>

          {/* Clear filters */}
          {(search || status || identityType) && (
            <button
              onClick={() => {
                setSearch("");
                router.push("/admin/users");
              }}
              className="px-3 py-2 text-gray-600 hover:text-gray-900"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Identity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Workspace
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usage
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Active
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/admin/users/${user.id}`)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt=""
                            className="w-8 h-8 rounded-full mr-3"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-200 mr-3 flex items-center justify-center text-gray-500 text-sm">
                            {(user.name || user.email || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-gray-900">
                            {user.name || "No name"}
                          </div>
                          <div className="text-sm text-gray-500">
                            {user.email || "No email"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getIdentityIcons(user)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getLicenseStatusBadge(user.licenseStatus)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {user.workspace?.name || "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      <div>{user.conversationCount} convos</div>
                      <div>{user.messageCount} msgs</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatRelativeTime(user.lastActivity)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => updateUrl({ page: String(currentPage - 1) })}
                disabled={currentPage <= 1}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>
              <button
                onClick={() => updateUrl({ page: String(currentPage + 1) })}
                disabled={currentPage >= pagination.totalPages}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
