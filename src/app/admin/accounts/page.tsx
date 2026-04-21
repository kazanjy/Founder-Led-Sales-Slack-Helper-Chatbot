"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

interface AccountUser {
  id: string;
  name: string | null;
  email: string | null;
  slackUserName: string | null;
  slackUserId: string | null;
  accountRole: string;
  workspaceId: string | null;
  workspace: { id: string; slackTeamName: string } | null;
}

interface Account {
  id: string;
  name: string;
  emailDomain: string | null;
  createdAt: string;
  _count: { users: number; channelClaims: number };
  channelClaims: ChannelClaim[];
  users: AccountUser[];
}

interface MigrationStats {
  total: number;
  migratable: number;
  noEmail: number;
}

export default function AdminAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  // Solo user migration state
  const [migrationStats, setMigrationStats] = useState<MigrationStats | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ migrated: number; skipped: number; errors: number } | null>(null);

  // Claim form state
  const [claimFormAccount, setClaimFormAccount] = useState<string | null>(null);
  const [claimChannelId, setClaimChannelId] = useState("");
  const [claimChannelName, setClaimChannelName] = useState("");
  const [claimWorkspaceId, setClaimWorkspaceId] = useState("");
  const [claimUserId, setClaimUserId] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/accounts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts);
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const fetchMigrationStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts/migrate-solo-users");
      if (res.ok) {
        const data = await res.json();
        setMigrationStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch migration stats:", error);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      if (!d.user) { router.push("/?error=not_logged_in"); return; }
      fetchAccounts();
      fetchMigrationStats();
    }).catch(() => router.push("/?error=not_logged_in"));
  }, [router, fetchAccounts, fetchMigrationStats]);

  const handleBulkMigrate = async () => {
    if (!confirm(`This will migrate ${migrationStats?.migratable || 0} solo users to accounts. Continue?`)) return;
    setMigrating(true);
    setMigrationResult(null);
    try {
      const res = await fetch("/api/admin/accounts/migrate-solo-users", { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        setMigrationResult(result);
        fetchAccounts();
        fetchMigrationStats();
      }
    } catch (error) {
      console.error("Bulk migration failed:", error);
    } finally {
      setMigrating(false);
    }
  };

  const handleClaimChannel = async (accountId: string) => {
    if (!claimChannelId || !claimWorkspaceId || !claimUserId) {
      setClaimError("Channel ID, workspace, and user are required");
      return;
    }

    setClaimSubmitting(true);
    setClaimError("");

    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/channel-claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slackChannelId: claimChannelId.trim(),
          slackChannelName: claimChannelName.trim() || null,
          workspaceId: claimWorkspaceId,
          claimedByUserId: claimUserId,
        }),
      });

      if (res.ok) {
        setClaimFormAccount(null);
        setClaimChannelId("");
        setClaimChannelName("");
        setClaimWorkspaceId("");
        setClaimUserId("");
        fetchAccounts();
      } else {
        const data = await res.json();
        setClaimError(data.error || "Failed to claim channel");
      }
    } catch {
      setClaimError("Network error");
    } finally {
      setClaimSubmitting(false);
    }
  };

  const handleDeleteClaim = async (accountId: string, claimId: string) => {
    if (!confirm("Remove this channel claim?")) return;

    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/channel-claims?claimId=${claimId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        fetchAccounts();
      }
    } catch (error) {
      console.error("Failed to delete claim:", error);
    }
  };

  // Get unique workspaces from account users
  const getWorkspacesForAccount = (account: Account) => {
    const workspaces = new Map<string, string>();
    for (const user of account.users) {
      if (user.workspace) {
        workspaces.set(user.workspace.id, user.workspace.slackTeamName);
      }
    }
    return Array.from(workspaces.entries()).map(([id, name]) => ({ id, name }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading accounts...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <input
          type="text"
          placeholder="Search accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm w-full sm:w-64"
        />
      </div>

      {/* Solo user migration banner */}
      {migrationStats && migrationStats.total > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-amber-800">
                {migrationStats.total} solo user{migrationStats.total !== 1 ? "s" : ""} without an account
              </h3>
              <p className="text-xs text-amber-700 mt-0.5">
                {migrationStats.migratable} can be auto-assigned by email domain
                {migrationStats.noEmail > 0 && (
                  <span> &middot; {migrationStats.noEmail} have no email (will be skipped)</span>
                )}
              </p>
            </div>
            <button
              onClick={handleBulkMigrate}
              disabled={migrating || migrationStats.migratable === 0}
              className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              {migrating ? "Migrating..." : "Migrate All"}
            </button>
          </div>
          {migrationResult && (
            <div className="mt-2 text-xs text-amber-800 bg-amber-100 rounded px-3 py-2">
              Done: {migrationResult.migrated} migrated, {migrationResult.skipped} skipped (no email)
              {migrationResult.errors > 0 && <span className="text-red-700">, {migrationResult.errors} errors</span>}
            </div>
          )}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No accounts found
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200"
            >
              {/* Account header */}
              <div
                className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() =>
                  setExpandedAccount(
                    expandedAccount === account.id ? null : account.id
                  )
                }
              >
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">
                    <Link
                      href={`/admin/accounts/${account.id}`}
                      className="hover:text-blue-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {account.name}
                    </Link>
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mt-1">
                    {account.emailDomain && (
                      <span>@{account.emailDomain}</span>
                    )}
                    <span>{account._count.users} user{account._count.users !== 1 ? "s" : ""}</span>
                    <span>{account._count.channelClaims} channel{account._count.channelClaims !== 1 ? "s" : ""} claimed</span>
                  </div>
                </div>
                <span className="text-gray-400 text-lg ml-2">
                  {expandedAccount === account.id ? "−" : "+"}
                </span>
              </div>

              {/* Expanded content */}
              {expandedAccount === account.id && (
                <div className="border-t border-gray-200 px-4 py-4 sm:px-6 space-y-6">
                  {/* Users */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Members</h4>
                    <div className="space-y-1">
                      {account.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                              user.accountRole === "OWNER"
                                ? "bg-purple-100 text-purple-700"
                                : user.accountRole === "ADMIN"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {user.accountRole}
                          </span>
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {user.name || user.email || user.slackUserName || user.id}
                          </Link>
                          {user.workspace && (
                            <span className="text-gray-400 text-xs">
                              ({user.workspace.slackTeamName})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Channel Claims */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-gray-700">
                        Claimed Channels
                      </h4>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setClaimFormAccount(
                            claimFormAccount === account.id ? null : account.id
                          );
                          setClaimError("");
                          setClaimChannelId("");
                          setClaimChannelName("");
                          setClaimWorkspaceId("");
                          setClaimUserId("");
                        }}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        + Claim Channel
                      </button>
                    </div>

                    {/* Claim form */}
                    {claimFormAccount === account.id && (
                      <div className="bg-gray-50 rounded-md p-3 mb-3 space-y-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-2">
                          To find a channel ID in Slack: right-click the channel &gt; &quot;View channel details&quot; &gt; scroll to the bottom. It starts with &quot;C&quot; (e.g., C0123456789).
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Channel ID *
                            </label>
                            <input
                              type="text"
                              placeholder="C0123456789"
                              value={claimChannelId}
                              onChange={(e) => setClaimChannelId(e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Channel Name (optional)
                            </label>
                            <input
                              type="text"
                              placeholder="#sales-team"
                              value={claimChannelName}
                              onChange={(e) =>
                                setClaimChannelName(e.target.value)
                              }
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Workspace *
                            </label>
                            <select
                              value={claimWorkspaceId}
                              onChange={(e) =>
                                setClaimWorkspaceId(e.target.value)
                              }
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="">Select workspace</option>
                              {getWorkspacesForAccount(account).map((ws) => (
                                <option key={ws.id} value={ws.id}>
                                  {ws.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Channel Owner (User) *
                            </label>
                            <select
                              value={claimUserId}
                              onChange={(e) => setClaimUserId(e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="">Select user</option>
                              {account.users.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name || user.email || user.slackUserName || user.id}
                                  {user.accountRole === "OWNER" ? " (Owner)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {claimError && (
                          <div className="text-red-600 text-xs">{claimError}</div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleClaimChannel(account.id)}
                            disabled={claimSubmitting}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                          >
                            {claimSubmitting ? "Claiming..." : "Claim Channel"}
                          </button>
                          <button
                            onClick={() => setClaimFormAccount(null)}
                            className="px-3 py-1.5 text-gray-600 text-sm hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Existing claims */}
                    {account.channelClaims.length === 0 ? (
                      <div className="text-sm text-gray-400 italic">
                        No channels claimed yet
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {account.channelClaims.map((claim) => (
                          <div
                            key={claim.id}
                            className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 border border-gray-100"
                          >
                            <div className="min-w-0">
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
                                <Link
                                  href={`/admin/users/${claim.claimedBy.id}`}
                                  className="text-blue-600 hover:underline"
                                >
                                  {claim.claimedBy.name ||
                                    claim.claimedBy.email ||
                                    claim.claimedBy.slackUserName}
                                </Link>
                                {" in "}
                                {claim.workspace.slackTeamName}
                                {" · "}
                                {new Date(claim.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                            <button
                              onClick={() =>
                                handleDeleteClaim(account.id, claim.id)
                              }
                              className="text-red-500 hover:text-red-700 text-xs ml-2 shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
