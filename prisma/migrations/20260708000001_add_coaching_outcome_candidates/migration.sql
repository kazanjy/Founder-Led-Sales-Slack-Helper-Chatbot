-- Implicit goal tracking: candidate goal/task updates inferred from a
-- coaching session's notes + transcript. Additive, nullable — safe to
-- apply to prod directly.
ALTER TABLE "coaching_sessions" ADD COLUMN "outcomeCandidates" JSONB;
ALTER TABLE "coaching_sessions" ADD COLUMN "outcomeCandidatesAt" TIMESTAMP(3);
ALTER TABLE "coaching_sessions" ADD COLUMN "outcomesReviewedAt" TIMESTAMP(3);
