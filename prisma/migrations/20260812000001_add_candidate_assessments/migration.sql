-- Candidate fit assessment (hiring). Additive — safe for prod.
CREATE TABLE "candidate_assessments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "hiringProfileVersionId" TEXT,
    "maturityStage" TEXT,
    "source" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL DEFAULT 'AE',
    "rawProfile" JSONB NOT NULL,
    "assessment" JSONB NOT NULL,
    "verdict" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL DEFAULT 'v1',
    "model" TEXT NOT NULL DEFAULT 'gpt-5.5',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_assessments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "candidate_assessments_userId_createdAt_idx" ON "candidate_assessments"("userId", "createdAt" DESC);
CREATE INDEX "candidate_assessments_userId_candidateKey_createdAt_idx" ON "candidate_assessments"("userId", "candidateKey", "createdAt" DESC);

ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
