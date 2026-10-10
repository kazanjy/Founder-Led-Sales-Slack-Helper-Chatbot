import { prisma } from "@/lib/db";

export type OnboardingStep = "recorder" | "calendar" | "narrative";

export interface StepState {
  done: boolean;
  dismissedUntil: string | null;
  dismissedForever: boolean;
}

export interface OnboardingState {
  recorder: StepState;
  calendar: StepState;
  narrative: StepState;
  currentStep: OnboardingStep | null;
}

const COOLDOWN_DAYS = 7;

interface StoredStep {
  dismissedUntil?: string | null;
  dismissedForever?: boolean;
}

interface StoredOnboardingState {
  recorder?: StoredStep;
  calendar?: StoredStep;
  narrative?: StoredStep;
}

function readStored(raw: unknown): StoredOnboardingState {
  if (!raw || typeof raw !== "object") return {};
  return raw as StoredOnboardingState;
}

function isSuppressed(step: StoredStep | undefined, now: Date): { until: string | null; forever: boolean } {
  if (!step) return { until: null, forever: false };
  const forever = !!step.dismissedForever;
  const until = step.dismissedUntil && new Date(step.dismissedUntil) > now ? step.dismissedUntil : null;
  return { until, forever };
}

export async function computeOnboardingState(userId: string): Promise<OnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleScopes: true,
      onboardingState: true,
      accountId: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const stored = readStored(user.onboardingState);
  const now = new Date();

  const [recorderConn, narrative, accountNarrative] = await Promise.all([
    prisma.meetingRecorderConnection.findFirst({
      where: { userId, status: "active" },
      select: { id: true },
    }),
    prisma.salesNarrativeVersion.findFirst({
      where: { userId },
      select: { id: true },
    }),
    user.accountId
      ? prisma.salesNarrativeVersion.findFirst({
          where: { user: { accountId: user.accountId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const recorderDone = !!recorderConn;
  const calendarDone =
    !!user.googleAccessToken && !!user.googleScopes && user.googleScopes.includes("calendar");
  const narrativeDone = !!narrative || !!accountNarrative;

  const recorderSuppression = isSuppressed(stored.recorder, now);
  const calendarSuppression = isSuppressed(stored.calendar, now);
  const narrativeSuppression = isSuppressed(stored.narrative, now);

  const state: OnboardingState = {
    recorder: {
      done: recorderDone,
      dismissedUntil: recorderSuppression.until,
      dismissedForever: recorderSuppression.forever,
    },
    calendar: {
      done: calendarDone,
      dismissedUntil: calendarSuppression.until,
      dismissedForever: calendarSuppression.forever,
    },
    narrative: {
      done: narrativeDone,
      dismissedUntil: narrativeSuppression.until,
      dismissedForever: narrativeSuppression.forever,
    },
    currentStep: null,
  };

  const order: OnboardingStep[] = ["recorder", "calendar", "narrative"];
  for (const step of order) {
    const s = state[step];
    if (!s.done && !s.dismissedForever && !s.dismissedUntil) {
      state.currentStep = step;
      break;
    }
  }

  return state;
}

export async function dismissStep(
  userId: string,
  step: OnboardingStep,
  kind: "once" | "forever"
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingState: true },
  });
  if (!user) throw new Error("User not found");

  const stored = readStored(user.onboardingState);
  const next: StoredOnboardingState = { ...stored };
  const existing = next[step] ?? {};

  if (kind === "forever") {
    next[step] = { ...existing, dismissedForever: true };
  } else {
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + COOLDOWN_DAYS);
    next[step] = { ...existing, dismissedUntil: until.toISOString() };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingState: next as unknown as object },
  });
}
