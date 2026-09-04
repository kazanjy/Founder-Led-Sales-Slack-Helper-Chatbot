-- A "reference report" link on each metric tile.
--
-- Metrics get argued about in coaching sessions because nobody can find
-- where the number came from. This puts the source — the Looker board,
-- the Sheet, the Stripe view — one click from the number it produced.
--
-- Both columns are nullable with no default: an existing metric simply
-- has no reference yet, and nothing about current behaviour changes
-- until someone sets one.

ALTER TABLE "coaching_metric_definitions"
  ADD COLUMN IF NOT EXISTS "referenceUrl" TEXT;

ALTER TABLE "coaching_metric_definitions"
  ADD COLUMN IF NOT EXISTS "referenceLabel" TEXT;
