-- Deal autopilot: triage judgments for calendar events + recordings.
-- Additive - safe to apply to prod directly.
CREATE TABLE "deal_triages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "verdict" TEXT NOT NULL,
    "category" TEXT,
    "confidence" DOUBLE PRECISION,
    "borderline" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "dealId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_triages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deal_triages_userId_source_sourceId_key" ON "deal_triages"("userId", "source", "sourceId");
CREATE INDEX "deal_triages_userId_createdAt_idx" ON "deal_triages"("userId", "createdAt" DESC);
ALTER TABLE "deal_triages" ADD CONSTRAINT "deal_triages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
