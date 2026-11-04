-- AlterTable
ALTER TABLE "users" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Backfill: set lastActiveAt from the most recent conversation's lastMessageAt
UPDATE "users" u
SET "lastActiveAt" = (
  SELECT MAX(c."lastMessageAt")
  FROM "conversations" c
  WHERE c."userId" = u."id"
)
WHERE EXISTS (
  SELECT 1 FROM "conversations" c WHERE c."userId" = u."id"
);
