-- Ad-hoc coaching sessions.
--
-- An ad-hoc session counts for everything except metrics: it still
-- appears in history, still gets a synthesis, still extracts goals and
-- tasks. It is simply skipped when seeding metric entries, when
-- resolving the previous value for a delta, and when building the
-- sparkline series — so a one-off conversation can't distort the
-- measurement cadence.
--
-- Backfilling every existing row to 'standard' preserves current
-- behaviour exactly.
ALTER TABLE "coaching_sessions"
  ADD COLUMN "sessionKind" TEXT NOT NULL DEFAULT 'standard';

-- The metric lookups filter on this column alongside sessionDate, so
-- an index keeps the delta/history queries cheap as history grows.
CREATE INDEX "coaching_sessions_sessionKind_idx"
  ON "coaching_sessions" ("sessionKind");
