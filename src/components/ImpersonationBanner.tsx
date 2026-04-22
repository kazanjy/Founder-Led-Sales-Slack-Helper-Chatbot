"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ImpersonationBannerProps {
  userName: string | null;
}

export function ImpersonationBanner({ userName }: ImpersonationBannerProps) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  const handleExit = async () => {
    setExiting(true);
    try {
      const res = await fetch("/api/auth/exit-impersonation", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch (error) {
      console.error("Failed to exit impersonation:", error);
      setExiting(false);
    }
  };

  return (
    <div className="bg-amber-500 text-white px-3 py-0.5 flex items-center justify-between fixed top-0 left-0 right-0 z-50 gap-1 leading-tight">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-[11px] truncate">
          Impersonating: {userName || "Unknown User"}
        </span>
        <span className="text-amber-200 text-[10px] hidden sm:inline">
          (You are viewing the app as this user)
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href="/admin"
          className="bg-amber-600 text-white px-1.5 py-0 rounded text-[10px] font-medium hover:bg-amber-700 border border-amber-400 leading-tight"
        >
          Admin
        </a>
        <button
          onClick={handleExit}
          disabled={exiting}
          className="bg-white text-amber-600 px-1.5 py-0 rounded text-[10px] font-medium hover:bg-amber-50 disabled:opacity-50 leading-tight"
        >
          {exiting ? "..." : "Exit"}
        </button>
      </div>
    </div>
  );
}
