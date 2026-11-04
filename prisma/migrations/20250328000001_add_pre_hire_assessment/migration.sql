CREATE TABLE "pre_hire_assessment_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Pre-Hire Assessment',
    "roleType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pre_hire_assessment_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pre_hire_assessment_versions_userId_createdAt_idx" ON "pre_hire_assessment_versions"("userId", "createdAt");

ALTER TABLE "pre_hire_assessment_versions" ADD CONSTRAINT "pre_hire_assessment_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
