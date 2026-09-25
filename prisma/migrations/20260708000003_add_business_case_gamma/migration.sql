-- Gamma slide-deck export links on business-case instances. Additive,
-- nullable — safe to apply to prod directly.
ALTER TABLE "business_case_instances" ADD COLUMN "gammaUrl" TEXT;
ALTER TABLE "business_case_instances" ADD COLUMN "gammaPdfUrl" TEXT;
ALTER TABLE "business_case_instances" ADD COLUMN "gammaPptxUrl" TEXT;
ALTER TABLE "business_case_instances" ADD COLUMN "gammaGeneratedAt" TIMESTAMP(3);
