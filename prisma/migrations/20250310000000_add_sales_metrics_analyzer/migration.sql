-- CreateTable
CREATE TABLE "sales_metrics_questions" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "globalOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "helpText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_metrics_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_metrics_answers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "answer" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_metrics_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_metrics_assessments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "conversationId" TEXT,
    "csvData" TEXT,
    "csvFileName" TEXT,
    "calculatedMetrics" TEXT,
    "analysisReport" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_metrics_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_metrics_questions_globalOrder_key" ON "sales_metrics_questions"("globalOrder");

-- CreateIndex
CREATE INDEX "sales_metrics_answers_userId_questionId_idx" ON "sales_metrics_answers"("userId", "questionId");

-- CreateIndex
CREATE INDEX "sales_metrics_answers_assessmentId_idx" ON "sales_metrics_answers"("assessmentId");

-- CreateIndex
CREATE INDEX "sales_metrics_assessments_userId_completedAt_idx" ON "sales_metrics_assessments"("userId", "completedAt");

-- AddForeignKey
ALTER TABLE "sales_metrics_answers" ADD CONSTRAINT "sales_metrics_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_metrics_answers" ADD CONSTRAINT "sales_metrics_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "sales_metrics_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_metrics_answers" ADD CONSTRAINT "sales_metrics_answers_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "sales_metrics_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_metrics_assessments" ADD CONSTRAINT "sales_metrics_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_metrics_assessments" ADD CONSTRAINT "sales_metrics_assessments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
