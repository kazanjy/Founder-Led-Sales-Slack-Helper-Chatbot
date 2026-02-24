-- AlterTable
ALTER TABLE "users" ADD COLUMN "secondary_emails" TEXT[] DEFAULT ARRAY[]::TEXT[];
