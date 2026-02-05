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
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between fixed top-0 left-0 right-0 z-50">
      <div className="flex items-center gap-2">
        <span className="font-medium">
          Impersonating: {userName || "Unknown User"}
        </span>
        <span className="text-amber-200 text-sm">
          (You are viewing the app as this user)
        </span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="bg-white text-amber-600 px-3 py-1 rounded text-sm font-medium hover:bg-amber-50 disabled:opacity-50"
      >
        {exiting ? "Exiting..." : "Exit Impersonation"}
      </button>
    </div>
  );
}
