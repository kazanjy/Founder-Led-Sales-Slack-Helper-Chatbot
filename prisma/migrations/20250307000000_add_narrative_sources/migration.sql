-- AlterTable
ALTER TABLE "sales_narrative_versions" ADD COLUMN "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "sales_narrative_versions" ADD COLUMN "sourcePdfNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
