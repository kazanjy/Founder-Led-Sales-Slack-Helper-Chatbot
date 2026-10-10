-- Quotes & Success Stories applet. Additive — safe for prod.
CREATE TABLE "success_story_collections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "dealId" TEXT,
    "themeFocus" TEXT,
    "sources" JSONB NOT NULL,
    "proofPoints" JSONB,
    "proofPointsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "success_story_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "success_assets" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "success_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "success_story_collections_userId_updatedAt_idx" ON "success_story_collections"("userId", "updatedAt" DESC);
CREATE INDEX "success_assets_collectionId_createdAt_idx" ON "success_assets"("collectionId", "createdAt" DESC);

ALTER TABLE "success_story_collections" ADD CONSTRAINT "success_story_collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "success_assets" ADD CONSTRAINT "success_assets_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "success_story_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
