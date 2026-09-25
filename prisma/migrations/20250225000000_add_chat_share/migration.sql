-- CreateTable
CREATE TABLE "chat_shares" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sharedByUserId" TEXT NOT NULL,
    "sharedToEmail" TEXT NOT NULL,
    "sharedToUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_shares_sharedToEmail_idx" ON "chat_shares"("sharedToEmail");

-- CreateIndex
CREATE INDEX "chat_shares_sharedToUserId_idx" ON "chat_shares"("sharedToUserId");

-- CreateIndex
CREATE INDEX "chat_shares_sharedByUserId_idx" ON "chat_shares"("sharedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_shares_conversationId_sharedToEmail_key" ON "chat_shares"("conversationId", "sharedToEmail");

-- AddForeignKey
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_sharedToUserId_fkey" FOREIGN KEY ("sharedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
