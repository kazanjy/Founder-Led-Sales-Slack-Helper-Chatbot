"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

/**
 * Deal alert configuration — on/off toggles per autopilot Slack alert
 * kind. Every alert in Slack carries a "🔕 Silence these alerts"
 * footer pointing here with ?silence=<kind>, which flips the bit on
 * arrival and confirms with a banner.
 */

interface AlertKind {
  key: string;
  emoji: string;
  label: string;
  description: string;
}

function AlertsConfigInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [kinds, setKinds] = useState<AlertKind[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/deals/alert-prefs");
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data) return;
        setKinds(Array.isArray(data.kinds) ? data.kinds : []);
        setPrefs(data.prefs || {});

        // ?silence=<kind> — the Slack footer deep link. Flip it off,
        // confirm, strip the param so refreshes don't re-silence.
        const silence = searchParams.get("silence");
        if (silence && data.prefs?.[silence] !== false) {
          const kindMeta = (data.kinds as AlertKind[]).find((k) => k.key === silence);
          if (kindMeta) {
            const post = await fetch("/api/deals/alert-prefs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: silence, enabled: false }),
            });
            const postData = await post.json().catch(() => null);
            if (post.ok && postData?.prefs && !cancelled) {
              setPrefs(postData.prefs);
              setBanner(`🔕 “${kindMeta.label}” alerts silenced. Flip the toggle below any time to turn them back on.`);
            }
          }
          router.replace("/deals/alerts", { scroll: false });
        } else if (silence) {
          const kindMeta = (data.kinds as AlertKind[]).find((k) => k.key === silence);
          if (kindMeta) setBanner(`🔕 “${kindMeta.label}” alerts were already silenced.`);
          router.replace("/deals/alerts", { scroll: false });
        }
      } catch { /* leave defaults */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (key: string, enabled: boolean) => {
    setSavingKey(key);
    setPrefs((prev) => ({ ...prev, [key]: enabled })); // optimistic
    try {
      const res = await fetch("/api/deals/alert-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: key, enabled }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.prefs) setPrefs(data.prefs);
      else setPrefs((prev) => ({ ...prev, [key]: !enabled })); // revert
    } catch {
      setPrefs((prev) => ({ ...prev, [key]: !enabled }));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SalesNavBar />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔔 Deal Alerts</h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Which autopilot alerts Mikey posts to your Slack (claimed channel, DM fallback).
          Off means that moment happens silently — the deal record still updates either way.{" "}
          <Link href="/deals" className="text-purple-600 dark:text-purple-300 hover:underline">← Back to deals</Link>
        </p>

        {banner && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200 text-sm">
            {banner}
          </div>
        )}

        {!loaded ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading preferences…</div>
        ) : (
          <div className="space-y-3">
            {kinds.map((k) => {
              const enabled = prefs[k.key] !== false;
              return (
                <div
                  key={k.key}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-start gap-4"
                >
                  <div className="text-2xl leading-none pt-0.5" aria-hidden>{k.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{k.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{k.description}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    disabled={savingKey === k.key}
                    onClick={() => toggle(k.key, !enabled)}
                    className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${
                      enabled ? "bg-purple-600" : "bg-gray-300 dark:bg-gray-600"
                    }`}
                    title={enabled ? "On — click to silence" : "Off — click to enable"}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-[22px]" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
          Every Slack alert also carries a &ldquo;🔕 Silence these alerts&rdquo; link that lands here
          with the matching toggle already flipped off.
        </p>
      </div>
    </div>
  );
}

export default function DealAlertsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950" />}>
      <AlertsConfigInner />
    </Suspense>
  );
}
