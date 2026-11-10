import { prisma } from "@/lib/db";

/**
 * Slack communication tone for deal auto-actions — the voice Mikey
 * uses when drafting messages that send AS the founder (task
 * execution drafts, detected-task draft messages). Stored as a
 * GtmVariable singleton (DEAL_SLACK_TONE, same no-migration pattern
 * as DEAL_ALERT_PREFS).
 *
 * The default below CHARACTERIZES the built-in voice; the settings
 * card pre-fills it so the founder edits a real starting point rather
 * than a blank box. Saving an empty (or unchanged-default) value
 * resets to default.
 */

const MERGE_FIELD = "DEAL_SLACK_TONE";

export const DEFAULT_DEAL_SLACK_TONE = `Warm, direct, and founder-casual — the way you'd actually type in Slack, not an email. Short conversational sentences, contractions welcome. Zero corporate filler ("just circling back", "hope this finds you well") and no fake enthusiasm or exclamation-point pile-ups. Reference the real conversation — names, promises, specifics — never generic pleasantries. Keep it brief: 2-5 sentences. End with something easy to respond to (a question or a light call to action).`;

export interface DealSlackTone {
  tone: string;
  isCustom: boolean;
}

/** Fail-safe: any read error returns the default voice. */
export async function getDealSlackTone(userId: string): Promise<DealSlackTone> {
  try {
    const row = await prisma.gtmVariable.findFirst({
      where: { userId, mergeField: MERGE_FIELD },
      select: { value: true },
    });
    const saved = row?.value?.trim();
    if (saved) return { tone: saved, isCustom: true };
  } catch { /* default voice */ }
  return { tone: DEFAULT_DEAL_SLACK_TONE, isCustom: false };
}

export async function setDealSlackTone(
  userId: string,
  tone: string
): Promise<DealSlackTone> {
  const trimmed = tone.trim().slice(0, 4000);
  // Empty or byte-identical to the default = reset (delete the row so
  // future default-copy improvements flow through automatically).
  if (!trimmed || trimmed === DEFAULT_DEAL_SLACK_TONE) {
    await prisma.gtmVariable.deleteMany({
      where: { userId, mergeField: MERGE_FIELD },
    });
    return { tone: DEFAULT_DEAL_SLACK_TONE, isCustom: false };
  }
  await prisma.gtmVariable.upsert({
    where: { userId_mergeField: { userId, mergeField: MERGE_FIELD } },
    update: { value: trimmed },
    create: {
      userId,
      mergeField: MERGE_FIELD,
      name: "Deal Slack Tone",
      value: trimmed,
      isDefault: false,
      sortOrder: 999,
    },
  });
  return { tone: trimmed, isCustom: true };
}
