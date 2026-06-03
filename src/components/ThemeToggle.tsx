"use client";

import { useEffect, useState } from "react";

/**
 * Three-way theme toggle (light / dark / system). Source of truth is
 * localStorage('mikey-theme'); the no-flash script in app/layout.tsx
 * reads the same key before paint. When 'system' is selected, we also
 * listen to prefers-color-scheme so the page tracks OS changes live.
 */

type Theme = "light" | "dark" | "system";

function applyTheme(t: Theme) {
  const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = t === "dark" || (t === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = (localStorage.getItem("mikey-theme") as Theme | null) || "system";
    setTheme(stored);

    // Track OS changes while in 'system' mode so the page flips in real time.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const t = (localStorage.getItem("mikey-theme") as Theme | null) || "system";
      if (t === "system") applyTheme("system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const pick = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("mikey-theme", t);
    applyTheme(t);
  };

  if (!mounted) {
    // Avoid hydration mismatch — server doesn't know which option is active.
    return <div className={compact ? "w-8 h-8" : "h-8 w-32"} aria-hidden />;
  }

  if (compact) {
    // Single-button cycle for tight nav slots: light → dark → system → light.
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const label = theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥";
    const title =
      theme === "light"
        ? "Light mode — click for dark"
        : theme === "dark"
        ? "Dark mode — click to follow system"
        : "Following system — click for light";
    return (
      <button
        type="button"
        onClick={() => pick(next)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-base hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        title={title}
        aria-label={title}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-800">
      {(["light", "dark", "system"] as const).map((t) => {
        const active = theme === t;
        const label = t === "light" ? "☀️ Light" : t === "dark" ? "🌙 Dark" : "🖥 System";
        return (
          <button
            key={t}
            type="button"
            onClick={() => pick(t)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              active
                ? "bg-purple-600 text-white"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
