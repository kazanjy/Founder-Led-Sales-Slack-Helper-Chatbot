-- Add iterationHistory to playbook version tables that support iterate
ALTER TABLE "sales_narrative_versions" ADD COLUMN "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "discovery_questions_versions" ADD COLUMN "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "first_call_checklist_versions" ADD COLUMN "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];
