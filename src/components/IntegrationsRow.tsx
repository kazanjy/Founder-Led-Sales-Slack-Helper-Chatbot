"use client";

import Link from "next/link";

interface IntegrationsRowProps {
  recorderConnected: boolean;
  calendarConnected: boolean;
}

interface Tile {
  emoji: string;
  label: string;
  description: string;
  connected: boolean;
  href: string;
  ctaLabel: string;
  external?: boolean;
}

export default function IntegrationsRow({
  recorderConnected,
  calendarConnected,
}: IntegrationsRowProps) {
  const tiles: Tile[] = [
    {
      emoji: "🎙️",
      label: "Meeting Recorder",
      description: "Auto-create deals, draft recaps, coach calls",
      connected: recorderConnected,
      href: "/call-review",
      ctaLabel: "Connect",
    },
    {
      emoji: "📅",
      label: "Google Calendar",
      description: "Pre-call research briefs + follow-up detection",
      connected: calendarConnected,
      href: "/api/auth/google?returnTo=/chat",
      ctaLabel: "Connect",
      external: true,
    },
  ];

  return (
    <div className="max-w-[950px] mx-auto w-full mb-6 md:mb-8">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Integrations:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
        {tiles.map((tile) =>
          tile.external && !tile.connected ? (
            <a
              key={tile.label}
              href={tile.href}
              className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-purple-300 hover:shadow-md transition-all group"
            >
              <TileBody tile={tile} />
            </a>
          ) : (
            <Link
              key={tile.label}
              href={tile.href}
              className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-purple-300 hover:shadow-md transition-all group"
            >
              <TileBody tile={tile} />
            </Link>
          )
        )}
      </div>
    </div>
  );
}

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <span className="text-2xl flex-shrink-0">{tile.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {tile.label}
          </span>
          {tile.connected ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
              Not connected
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
          {tile.description}
        </p>
      </div>
      <span className="text-xs font-medium text-purple-600 dark:text-purple-400 group-hover:underline shrink-0">
        {tile.connected ? "Manage →" : `${tile.ctaLabel} →`}
      </span>
    </>
  );
}
