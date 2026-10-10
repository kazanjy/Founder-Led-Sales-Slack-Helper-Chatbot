-- Add Gamma presentation fields to sales_deck_versions
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "contextUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "contextPdfNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "prospectUrl" TEXT;
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "brandAnalysis" TEXT;
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "gammaUrl" TEXT;
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "gammaPdfUrl" TEXT;
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "gammaPptxUrl" TEXT;
ALTER TABLE "sales_deck_versions" ADD COLUMN IF NOT EXISTS "gammaInputContent" TEXT;
