import { prisma } from "@/lib/db";

/**
 * Per-user deal alert preferences — which autopilot Slack alerts fire.
 * Stored as a JSON blob in a GtmVariable singleton (DEAL_ALERT_PREFS,
 * same no-migration pattern as NEXT_SESSION_TOPICS). Missing key =
 * enabled; only explicit false silences a kind.
 *
 * Every Slack alert carries a "🔕 Silence these alerts" footer link to
 * /deals/alerts?silence=<kind>, which flips the bit and lands on the
 * config page.
 */

const MERGE_FIELD = "DEAL_ALERT_PREFS";

export interface DealAlertKind {
  key: string;
  emoji: string;
  label: string;
  description: string;
}

export const DEAL_ALERT_KINDS: DealAlertKind[] = [
  {
    key: "new_deal",
    emoji: "🎯",
    label: "New deal detected",
    description:
      "A new deal was auto-created — from a calendar invite (pre-meeting triage) or a call recording that didn't match an existing deal.",
  },
  {
    key: "deal_confirmed",
    emoji: "✅",
    label: "Deal confirmed",
    description:
      "A recording verified that a watched deal is a real sales conversation (status flipped to Active, analysis kicked off).",
  },
  {
    key: "deal_archived",
    emoji: "🗂️",
    label: "Deal archived",
    description:
      "The autopilot archived a deal (call read as not-a-deal, or a likely deal expired) — includes the Undo link.",
  },
  {
    key: "precall_plan",
    emoji: "📋",
    label: "Pre-call plan (4h before meetings)",
    description:
      "The pre-call brief stub with objectives, practice links, and the full prep threaded under it.",
  },
  {
    key: "analysis_update",
    emoji: "🧠",
    label: "Updated deal analysis",
    description:
      "Posted after new evidence triggers a re-analysis (recording landed, entry pasted, new meeting) — health pill + synopsis + full analysis in the thread.",
  },
  {
    key: "no_recording_nudge",
    emoji: "🕵",
    label: "No-recording nudge",
    description:
      "One-time nudge when a watched deal's call happened over a week ago but no recording ever landed.",
  },
  {
    key: "task_execution",
    emoji: "⚡",
    label: "Proposed task execution",
    description:
      "A scheduled deal task came due — the ping carries the drafted message and the one-touch \"Do it\" link that sends it into the deal's linked Slack channel as you.",
  },
];

const VALID_KEYS = new Set(DEAL_ALERT_KINDS.map((k) => k.key));

export function isValidAlertKind(kind: string): boolean {
  return VALID_KEYS.has(kind);
}

export async function getDealAlertPrefs(userId: string): Promise<Record<string, boolean>> {
  const prefs: Record<string, boolean> = {};
  for (const k of DEAL_ALERT_KINDS) prefs[k.key] = true;
  try {
    const row = await prisma.gtmVariable.findFirst({
      where: { userId, mergeField: MERGE_FIELD },
      select: { value: true },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        if (VALID_KEYS.has(key) && typeof parsed[key] === "boolean") {
          prefs[key] = parsed[key] as boolean;
        }
      }
    }
  } catch { /* default all-on */ }
  return prefs;
}

/** Gate for the stub posters. Fails OPEN — a prefs-read error never
 *  suppresses an alert. */
export async function isAlertEnabled(userId: string, kind: string): Promise<boolean> {
  if (!VALID_KEYS.has(kind)) return true;
  try {
    const prefs = await getDealAlertPrefs(userId);
    return prefs[kind] !== false;
  } catch {
    return true;
  }
}

export async function setDealAlertPref(
  userId: string,
  kind: string,
  enabled: boolean
): Promise<Record<string, boolean>> {
  const prefs = await getDealAlertPrefs(userId);
  if (VALID_KEYS.has(kind)) prefs[kind] = enabled;
  await prisma.gtmVariable.upsert({
    where: { userId_mergeField: { userId, mergeField: MERGE_FIELD } },
    update: { value: JSON.stringify(prefs) },
    create: {
      userId,
      mergeField: MERGE_FIELD,
      name: "Deal Alert Preferences",
      value: JSON.stringify(prefs),
      isDefault: false,
      sortOrder: 999,
    },
  });
  return prefs;
}

/** The "🔕 Silence these alerts" footer — appended to every deal
 *  alert's blocks. */
export function alertFooterBlock(kind: string, appUrl: string) {
  return {
    type: "context" as const,
    elements: [
      {
        type: "mrkdwn" as const,
        text: `<${appUrl}/deals/alerts?silence=${encodeURIComponent(kind)}|🔕 Silence these alerts>`,
      },
    ],
  };
}
