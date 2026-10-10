-- CreateTable
CREATE TABLE "shared_documents" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "shareCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_documents_shareCode_key" ON "shared_documents"("shareCode");

-- CreateIndex
CREATE INDEX "shared_documents_documentType_documentId_idx" ON "shared_documents"("documentType", "documentId");

-- AddForeignKey
ALTER TABLE "shared_documents" ADD CONSTRAINT "shared_documents_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
