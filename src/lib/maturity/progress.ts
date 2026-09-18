export type MaturityStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "update_in_progress";

export interface ProgressInput {
  answeredCount: number;
  totalQuestions: number;
  updateInProgress: boolean;
}

export function determineMaturityStatus(input: ProgressInput): MaturityStatus {
  const { answeredCount, totalQuestions, updateInProgress } = input;

  if (updateInProgress) {
    return "update_in_progress";
  }

  if (answeredCount === 0) {
    return "not_started";
  }

  if (answeredCount >= totalQuestions) {
    return "completed";
  }

  return "in_progress";
}

export function calculateProgressPercent(
  answeredCount: number,
  totalQuestions: number
): number {
  if (totalQuestions === 0) return 0;
  return Math.round((answeredCount / totalQuestions) * 100);
}
