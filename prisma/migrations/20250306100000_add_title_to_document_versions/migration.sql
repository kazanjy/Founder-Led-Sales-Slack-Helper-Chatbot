-- AlterTable
ALTER TABLE "sales_narrative_versions" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Sales Narrative';

-- AlterTable
ALTER TABLE "discovery_questions_versions" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Discovery Questions';

-- AlterTable
ALTER TABLE "first_call_checklist_versions" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'First Call Checklist';

-- AlterTable
ALTER TABLE "pre_call_planning_versions" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Pre-Call Planning';
