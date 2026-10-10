-- Business Cases suite: Discovery Summary / ROI Model / Business Case
-- share one discriminated template + instance pair. Additive — safe to
-- apply to prod directly.

CREATE TABLE "business_case_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceInputs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_case_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_case_instances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "templateId" TEXT,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_case_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_case_templates_userId_type_createdAt_idx" ON "business_case_templates"("userId", "type", "createdAt" DESC);

CREATE INDEX "business_case_instances_userId_type_createdAt_idx" ON "business_case_instances"("userId", "type", "createdAt" DESC);

CREATE INDEX "business_case_instances_dealId_type_idx" ON "business_case_instances"("dealId", "type");

ALTER TABLE "business_case_templates" ADD CONSTRAINT "business_case_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "business_case_instances" ADD CONSTRAINT "business_case_instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "business_case_instances" ADD CONSTRAINT "business_case_instances_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
