-- AlterTable
ALTER TABLE "coaching_metric_definitions" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'number';

-- Update existing ARR metrics to currency format
UPDATE "coaching_metric_definitions" SET "format" = 'currency' WHERE "name" ILIKE '%arr%' OR "name" ILIKE '%revenue%' OR "name" ILIKE '%mrr%';
