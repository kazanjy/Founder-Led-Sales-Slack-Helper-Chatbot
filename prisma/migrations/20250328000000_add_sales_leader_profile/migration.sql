-- CreateTable: sales_leader_profile_questions
CREATE TABLE "sales_leader_profile_questions" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "globalOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "helpText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_leader_profile_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sales_leader_profile_answers
CREATE TABLE "sales_leader_profile_answers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionId" TEXT,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_leader_profile_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sales_leader_profile_versions
CREATE TABLE "sales_leader_profile_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Sales Leader Hiring Profile',
    "content" TEXT NOT NULL,
    "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_leader_profile_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_leader_profile_questions_globalOrder_key" ON "sales_leader_profile_questions"("globalOrder");
CREATE INDEX "sales_leader_profile_answers_userId_questionId_idx" ON "sales_leader_profile_answers"("userId", "questionId");
CREATE INDEX "sales_leader_profile_answers_versionId_idx" ON "sales_leader_profile_answers"("versionId");
CREATE INDEX "sales_leader_profile_versions_userId_createdAt_idx" ON "sales_leader_profile_versions"("userId", "createdAt");

ALTER TABLE "sales_leader_profile_answers" ADD CONSTRAINT "sales_leader_profile_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_leader_profile_answers" ADD CONSTRAINT "sales_leader_profile_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "sales_leader_profile_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_leader_profile_answers" ADD CONSTRAINT "sales_leader_profile_answers_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "sales_leader_profile_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_leader_profile_versions" ADD CONSTRAINT "sales_leader_profile_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
