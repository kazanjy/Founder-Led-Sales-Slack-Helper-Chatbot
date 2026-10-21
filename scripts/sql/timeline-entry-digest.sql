-- One-time call-transcript digests on deal timeline entries.
--
-- Re-analyses were re-sending every transcript in full on every run
-- (~100K chars each, up to a 600K-char ceiling), paying again each time
-- to re-derive conclusions already stored in the deal's lastAnalysis.
-- A transcript is now digested once and the digest is what later
-- analyses read.
--
-- Both columns are nullable with no default: NULL means "not digested
-- yet", which the analyzer handles by falling back to a one-line index
-- entry. So this migration is safe to apply before the code ships, and
-- the code is safe to run before any digest exists.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE "deal_timeline_entries" ADD COLUMN IF NOT EXISTS "digest"     TEXT;
ALTER TABLE "deal_timeline_entries" ADD COLUMN IF NOT EXISTS "digestedAt" TIMESTAMP(3);

-- Drives the sweep's "call entries not yet digested" lookup.
CREATE INDEX IF NOT EXISTS "deal_timeline_entries_type_digestedAt_idx"
  ON "deal_timeline_entries" ("type", "digestedAt");

COMMIT;
