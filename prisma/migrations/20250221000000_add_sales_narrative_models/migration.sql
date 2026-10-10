-- CreateTable: Sales Narrative Questions
CREATE TABLE "sales_narrative_questions" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "globalOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "helpText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_narrative_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Sales Narrative Answers
CREATE TABLE "sales_narrative_answers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionId" TEXT,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_narrative_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Sales Narrative Versions
CREATE TABLE "sales_narrative_versions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "description100w" TEXT NOT NULL,
    "description50w" TEXT NOT NULL,
    "description25w" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_narrative_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_narrative_questions_globalOrder_key" ON "sales_narrative_questions"("globalOrder");

-- CreateIndex
CREATE INDEX "sales_narrative_answers_userId_questionId_idx" ON "sales_narrative_answers"("userId", "questionId");

-- CreateIndex
CREATE INDEX "sales_narrative_answers_versionId_idx" ON "sales_narrative_answers"("versionId");

-- CreateIndex
CREATE INDEX "sales_narrative_versions_userId_createdAt_idx" ON "sales_narrative_versions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "sales_narrative_answers" ADD CONSTRAINT "sales_narrative_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_narrative_answers" ADD CONSTRAINT "sales_narrative_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "sales_narrative_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_narrative_answers" ADD CONSTRAINT "sales_narrative_answers_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "sales_narrative_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_narrative_versions" ADD CONSTRAINT "sales_narrative_versions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
