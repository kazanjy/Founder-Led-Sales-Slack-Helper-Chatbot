-- AlterTable: Add privacy and account sharing flags
ALTER TABLE "conversations" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "sharedWithAccount" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: Track chat views for "recently viewed" feature
CREATE TABLE "chat_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_views_userId_conversationId_key" ON "chat_views"("userId", "conversationId");
CREATE INDEX "chat_views_userId_viewedAt_idx" ON "chat_views"("userId", "viewedAt" DESC);

-- AddForeignKey
ALTER TABLE "chat_views" ADD CONSTRAINT "chat_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_views" ADD CONSTRAINT "chat_views_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
