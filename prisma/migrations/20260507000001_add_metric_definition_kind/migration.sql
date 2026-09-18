-- Distinguish normal metric tiles from full-width section header
-- strips ("metric" vs "section") so the metrics panel can be
-- grouped into named sections without a separate sections table.
-- Sections share the order column with metrics so drag-to-reorder
-- works uniformly. Backfilled to "metric" for every existing row.

ALTER TABLE "coaching_metric_definitions"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'metric';
