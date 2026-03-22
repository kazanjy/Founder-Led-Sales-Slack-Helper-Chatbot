-- CreateTable
CREATE TABLE "public_answers" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "preview" VARCHAR(280) NOT NULL,
    "source" TEXT NOT NULL,
    "twitterTweetId" TEXT,
    "twitterTweetUrl" TEXT,
    "twitterHandle" TEXT,
    "twitterThreadContext" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'published',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_answers_slug_key" ON "public_answers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "public_answers_twitterTweetId_key" ON "public_answers"("twitterTweetId");

-- CreateIndex
CREATE INDEX "public_answers_slug_idx" ON "public_answers"("slug");

-- CreateIndex
CREATE INDEX "public_answers_source_createdAt_idx" ON "public_answers"("source", "createdAt");

-- CreateIndex
CREATE INDEX "public_answers_status_createdAt_idx" ON "public_answers"("status", "createdAt");
