-- AlterTable
ALTER TABLE "users" ADD COLUMN "secondaryEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
