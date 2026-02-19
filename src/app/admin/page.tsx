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

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

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
