"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  totalLicenses: number;
  activeLicenses: number;
  manualLicenses: number;
  stripeLicenses: number;
  activeUsers: number;
  estimatedMRR: number;
}

interface License {
  id: string;
  type: string;
  status: string;
  expiresAt: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  manuallyGranted: boolean;
  notes: string | null;
  createdAt: string;
  users: { id: string; email: string | null; name: string | null }[];
}

export default function AdminBillingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Admin - Billing";
  }, []);

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch("/api/admin/billing");
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats);
          setLicenses(data.recentLicenses);
        }
      } catch (error) {
        console.error("Failed to fetch billing:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchBilling();
  }, []);

  if (loading) {
    return <div className="text-gray-500">Loading billing data...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Billing</h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">
              ${stats.estimatedMRR.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Estimated MRR</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">
              {stats.activeUsers}
            </div>
            <div className="text-sm text-gray-500">Active Users</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">
              {stats.activeLicenses}
            </div>
            <div className="text-sm text-gray-500">Active Licenses</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-blue-600">
              {stats.stripeLicenses}
            </div>
            <div className="text-sm text-gray-500">Stripe Subscriptions</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-yellow-600">
              {stats.manualLicenses}
            </div>
            <div className="text-sm text-gray-500">Manual Licenses</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-600">
              {stats.totalLicenses}
            </div>
            <div className="text-sm text-gray-500">Total Licenses</div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://dashboard.stripe.com/subscriptions"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            Open Stripe Dashboard
          </a>
          <a
            href="https://dashboard.stripe.com/customers"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            View Customers
          </a>
        </div>
      </div>

      {/* Recent Licenses */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Active Licenses</h2>
        </div>
        {licenses.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No active licenses</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    License
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User(s)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {licenses.map((license) => (
                  <tr key={license.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm text-gray-600">
                        {license.id.slice(0, 8)}...
                      </div>
                      <div className="text-xs text-gray-400">
                        {license.status}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {license.users.length === 0 ? (
                        <span className="text-gray-400">No users</span>
                      ) : (
                        <div className="space-y-1">
                          {license.users.slice(0, 3).map((user) => (
                            <div key={user.id}>
                              <Link
                                href={`/admin/users/${user.id}`}
                                className="text-blue-600 hover:text-blue-800 text-sm"
                              >
                                {user.name || user.email || user.id.slice(0, 8)}
                              </Link>
                            </div>
                          ))}
                          {license.users.length > 3 && (
                            <div className="text-xs text-gray-500">
                              +{license.users.length - 3} more
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {license.type}
                    </td>
                    <td className="px-4 py-3">
                      {license.stripeSubscriptionId ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Stripe
                        </span>
                      ) : license.manuallyGranted ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Manual
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Other
                        </span>
                      )}
                      {license.notes && (
                        <div className="text-xs text-gray-500 mt-1">
                          {license.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(license.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {license.stripeSubscriptionId && (
                        <a
                          href={`https://dashboard.stripe.com/subscriptions/${license.stripeSubscriptionId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-600 hover:text-purple-800 text-sm"
                        >
                          View in Stripe
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
