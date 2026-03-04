"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/chat", label: "💬 Chat" },
  { href: "/sales-narrative", label: "📖 Sales Narrative" },
  { href: "/discovery-questions", label: "🔍 Discovery Questions" },
  { href: "/first-call-checklist", label: "✅ First Call Checklist" },
  { href: "/pre-call-planning", label: "📋 Pre-Call Planning" },
  { href: "/pre-call-planning/research", label: "🔬 Pre-Call Research" },
];

export default function SalesNavBar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/chat") return pathname === "/chat" || pathname.startsWith("/chat/");
    if (href === "/pre-call-planning/research") return pathname.startsWith("/pre-call-planning/research");
    if (href === "/pre-call-planning") return pathname === "/pre-call-planning" || pathname === "/pre-call-planning/history";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mb-px">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive(item.href)
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
