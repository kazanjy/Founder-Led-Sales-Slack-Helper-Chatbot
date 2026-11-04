-- CreateTable: hiring_profile_questions
CREATE TABLE "hiring_profile_questions" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "globalOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "helpText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_profile_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: hiring_profile_answers
CREATE TABLE "hiring_profile_answers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionId" TEXT,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_profile_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: hiring_profile_versions
CREATE TABLE "hiring_profile_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'AE Hiring Profile',
    "content" TEXT NOT NULL,
    "iterationHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hiring_profile_questions_globalOrder_key" ON "hiring_profile_questions"("globalOrder");

-- CreateIndex
CREATE INDEX "hiring_profile_answers_userId_questionId_idx" ON "hiring_profile_answers"("userId", "questionId");

-- CreateIndex
CREATE INDEX "hiring_profile_answers_versionId_idx" ON "hiring_profile_answers"("versionId");

-- CreateIndex
CREATE INDEX "hiring_profile_versions_userId_createdAt_idx" ON "hiring_profile_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "hiring_profile_answers" ADD CONSTRAINT "hiring_profile_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_profile_answers" ADD CONSTRAINT "hiring_profile_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "hiring_profile_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_profile_answers" ADD CONSTRAINT "hiring_profile_answers_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "hiring_profile_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_profile_versions" ADD CONSTRAINT "hiring_profile_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
