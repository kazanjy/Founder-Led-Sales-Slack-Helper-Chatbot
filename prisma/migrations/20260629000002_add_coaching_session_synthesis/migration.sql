-- Persist the auto-generated "Session Synthesis" produced after each
-- save. Same prompt as the in-app "Synthesize Takeaways" CTA — runs
-- on save so the founder doesn't have to click. Nullable so existing
-- sessions remain unaffected; populated lazily by the on-save trigger.
ALTER TABLE "coaching_sessions"
  ADD COLUMN "synthesis" TEXT,
  ADD COLUMN "synthesisAt" TIMESTAMP(3);
