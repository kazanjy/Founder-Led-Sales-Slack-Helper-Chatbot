"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface SearchResult {
  users: { id: string; name: string | null; email: string | null; avatarUrl: string | null; licenseStatus: string }[];
  accounts: { id: string; name: string; emailDomain: string | null; userCount: number }[];
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(null);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await fetch("/api/admin/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          router.push("/chat");
        }
      } catch {
        router.push("/chat");
      } finally {
        setLoading(false);
      }
    }
    checkAdmin();
  }, [router]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on route change
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }, [pathname]);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
        setSearchOpen(true);
        setSelectedIndex(-1);
      }
    } catch {
      // ignore
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  };

  // Build flat list of navigable results for keyboard nav
  const flatResults: { type: "user" | "account"; id: string }[] = [];
  if (searchResults) {
    for (const u of searchResults.users) flatResults.push({ type: "user", id: u.id });
    for (const a of searchResults.accounts) flatResults.push({ type: "account", id: a.id });
  }

  const navigateToResult = (item: { type: "user" | "account"; id: string }) => {
    if (item.type === "user") router.push(`/admin/users/${item.id}`);
    else router.push(`/admin/accounts/${item.id}`);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIndex >= 0 && flatResults[selectedIndex]) {
      e.preventDefault();
      navigateToResult(flatResults[selectedIndex]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
      inputRef.current?.blur();
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "ACTIVE": return "bg-green-100 text-green-700";
      case "TRIAL": return "bg-blue-100 text-blue-700";
      case "EXPIRED": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const navItems = [
    { href: "/admin", label: "Dashboard", icon: "📊" },
    { href: "/admin/accounts", label: "Accounts", icon: "🏠" },
    { href: "/admin/users", label: "Users", icon: "👥" },
    { href: "/admin/workspaces", label: "Workspaces", icon: "🏢" },
    { href: "/admin/channels", label: "Channels", icon: "📣" },
    { href: "/admin/billing", label: "Billing", icon: "💳" },
  ];

  const hasResults = searchResults && (searchResults.users.length > 0 || searchResults.accounts.length > 0);
  const noResults = searchResults && searchResults.users.length === 0 && searchResults.accounts.length === 0;
  let flatIndex = 0;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top nav */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/admin" className="flex items-center">
                <span className="text-xl font-bold text-gray-900">Mikey Admin</span>
              </Link>
              <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      pathname === item.href
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    <span className="mr-1">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
              {/* Search */}
              <div ref={searchRef} className="relative hidden sm:block">
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    onFocus={() => { if (searchResults) setSearchOpen(true); }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search users & accounts..."
                    className="w-56 lg:w-72 pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {searchLoading && (
                    <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {!searchLoading && searchQuery.length === 0 && (
                    <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden lg:inline-flex items-center px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-100 border border-gray-200 rounded font-mono">
                      ⌘K
                    </kbd>
                  )}
                </div>

                {/* Dropdown */}
                {searchOpen && (hasResults || noResults) && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
                    {noResults && (
                      <div className="px-4 py-6 text-center text-sm text-gray-500">
                        No results for &ldquo;{searchQuery}&rdquo;
                      </div>
                    )}

                    {searchResults && searchResults.users.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                          Users
                        </div>
                        {searchResults.users.map((u) => {
                          const idx = flatIndex++;
                          return (
                            <button
                              key={u.id}
                              onClick={() => navigateToResult({ type: "user", id: u.id })}
                              className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-blue-50 transition-colors ${
                                selectedIndex === idx ? "bg-blue-50" : ""
                              }`}
                            >
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm flex-shrink-0">
                                  {(u.name || u.email || "?")[0].toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-900 truncate">{u.name || "—"}</div>
                                <div className="text-xs text-gray-500 truncate">{u.email || "—"}</div>
                              </div>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusColor(u.licenseStatus)}`}>
                                {u.licenseStatus}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {searchResults && searchResults.accounts.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-t border-gray-100">
                          Accounts
                        </div>
                        {searchResults.accounts.map((a) => {
                          const idx = flatIndex++;
                          return (
                            <button
                              key={a.id}
                              onClick={() => navigateToResult({ type: "account", id: a.id })}
                              className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-blue-50 transition-colors ${
                                selectedIndex === idx ? "bg-blue-50" : ""
                              }`}
                            >
                              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-sm flex-shrink-0">
                                {a.name[0].toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-900 truncate">{a.name}</div>
                                {a.emailDomain && (
                                  <div className="text-xs text-gray-500 truncate">{a.emailDomain}</div>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 flex-shrink-0">
                                {a.userCount} {a.userCount === 1 ? "user" : "users"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <span className="text-sm text-gray-500 hidden sm:inline truncate max-w-[150px]">{user.email}</span>
              <Link
                href="/chat"
                className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap"
              >
                Back to App
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className="sm:hidden bg-white border-b border-gray-200 px-4 py-2 flex space-x-2 overflow-x-auto">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
              pathname === item.href
                ? "bg-gray-100 text-gray-900"
                : "text-gray-600"
            }`}
          >
            {item.icon} {item.label}
          </Link>
        ))}
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
