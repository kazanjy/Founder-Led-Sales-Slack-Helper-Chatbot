import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export interface AttachmentPreference {
  enabled: boolean;
  disabledUntil: string | null;
}

export interface AttachmentPreferences {
  salesNarrative: AttachmentPreference;
  gtmAssessment: AttachmentPreference;
  discoveryQuestions: AttachmentPreference;
  firstCallChecklist: AttachmentPreference;
}

const DEFAULT_PREFERENCES: AttachmentPreferences = {
  salesNarrative: { enabled: true, disabledUntil: null },
  gtmAssessment: { enabled: false, disabledUntil: null },
  discoveryQuestions: { enabled: false, disabledUntil: null },
  firstCallChecklist: { enabled: false, disabledUntil: null },
};

// Helper to check if a preference is effectively enabled (respecting disabledUntil timer)
function isEffectivelyEnabled(pref: AttachmentPreference, defaultEnabled: boolean): boolean {
  // If there's a disabledUntil time and it hasn't passed, it's disabled
  if (pref.disabledUntil) {
    const disabledUntil = new Date(pref.disabledUntil);
    if (disabledUntil > new Date()) {
      return false;
    }
    // Timer has passed, revert to default behavior
    return defaultEnabled;
  }
  return pref.enabled;
}

// GET - Fetch user's attachment preferences
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const prefRecord = await prisma.userAttachmentPreference.findUnique({
      where: { userId: user.id },
    });

    let preferences: AttachmentPreferences;
    if (prefRecord?.preferences) {
      // Merge stored preferences with defaults
      const stored = prefRecord.preferences as Partial<AttachmentPreferences>;
      preferences = {
        salesNarrative: stored.salesNarrative || DEFAULT_PREFERENCES.salesNarrative,
        gtmAssessment: stored.gtmAssessment || DEFAULT_PREFERENCES.gtmAssessment,
        discoveryQuestions: stored.discoveryQuestions || DEFAULT_PREFERENCES.discoveryQuestions,
        firstCallChecklist: stored.firstCallChecklist || DEFAULT_PREFERENCES.firstCallChecklist,
      };
    } else {
      preferences = DEFAULT_PREFERENCES;
    }

    // Calculate effective state (considering disabledUntil timers)
    const effectivePreferences = {
      salesNarrative: isEffectivelyEnabled(preferences.salesNarrative, DEFAULT_PREFERENCES.salesNarrative.enabled),
      gtmAssessment: isEffectivelyEnabled(preferences.gtmAssessment, DEFAULT_PREFERENCES.gtmAssessment.enabled),
      discoveryQuestions: isEffectivelyEnabled(preferences.discoveryQuestions, DEFAULT_PREFERENCES.discoveryQuestions.enabled),
      firstCallChecklist: isEffectivelyEnabled(preferences.firstCallChecklist, DEFAULT_PREFERENCES.firstCallChecklist.enabled),
    };

    return NextResponse.json({
      preferences,
      effectivePreferences,
    });
  } catch (error) {
    console.error("Error fetching attachment preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch attachment preferences" },
      { status: 500 }
    );
  }
}

// PATCH - Update user's attachment preferences
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { attachmentId, enabled } = body;

    if (!attachmentId || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Missing attachmentId or enabled field" },
        { status: 400 }
      );
    }

    const validAttachments = ["salesNarrative", "gtmAssessment", "discoveryQuestions", "firstCallChecklist"];
    if (!validAttachments.includes(attachmentId)) {
      return NextResponse.json(
        { error: "Invalid attachment ID" },
        { status: 400 }
      );
    }

    // Get existing preferences
    const existingRecord = await prisma.userAttachmentPreference.findUnique({
      where: { userId: user.id },
    });

    const existingPrefs = (existingRecord?.preferences || {}) as Partial<AttachmentPreferences>;

    // Determine if we're disabling a default-on attachment (needs 24h timer)
    const isDefaultOn = attachmentId === "salesNarrative";

    // Build updated preference for this attachment
    let updatedPref: AttachmentPreference;
    if (!enabled && isDefaultOn) {
      // User is disabling a default-on attachment - set 24h timer
      const disabledUntil = new Date();
      disabledUntil.setHours(disabledUntil.getHours() + 24);
      updatedPref = { enabled: false, disabledUntil: disabledUntil.toISOString() };
    } else {
      // Normal enable/disable
      updatedPref = { enabled, disabledUntil: null };
    }

    // Merge with existing preferences
    const updatedPrefs: AttachmentPreferences = {
      salesNarrative: existingPrefs.salesNarrative || DEFAULT_PREFERENCES.salesNarrative,
      gtmAssessment: existingPrefs.gtmAssessment || DEFAULT_PREFERENCES.gtmAssessment,
      discoveryQuestions: existingPrefs.discoveryQuestions || DEFAULT_PREFERENCES.discoveryQuestions,
      firstCallChecklist: existingPrefs.firstCallChecklist || DEFAULT_PREFERENCES.firstCallChecklist,
      [attachmentId]: updatedPref,
    };

    // Upsert the record (cast to satisfy Prisma's JSON type)
    const prefsJson = JSON.parse(JSON.stringify(updatedPrefs));
    await prisma.userAttachmentPreference.upsert({
      where: { userId: user.id },
      update: { preferences: prefsJson },
      create: { userId: user.id, preferences: prefsJson },
    });

    // Calculate effective state
    const effectivePreferences = {
      salesNarrative: isEffectivelyEnabled(updatedPrefs.salesNarrative, DEFAULT_PREFERENCES.salesNarrative.enabled),
      gtmAssessment: isEffectivelyEnabled(updatedPrefs.gtmAssessment, DEFAULT_PREFERENCES.gtmAssessment.enabled),
      discoveryQuestions: isEffectivelyEnabled(updatedPrefs.discoveryQuestions, DEFAULT_PREFERENCES.discoveryQuestions.enabled),
      firstCallChecklist: isEffectivelyEnabled(updatedPrefs.firstCallChecklist, DEFAULT_PREFERENCES.firstCallChecklist.enabled),
    };

    return NextResponse.json({
      success: true,
      preferences: updatedPrefs,
      effectivePreferences,
    });
  } catch (error) {
    console.error("Error updating attachment preferences:", error);
    return NextResponse.json(
      { error: "Failed to update attachment preferences" },
      { status: 500 }
    );
  }
}
