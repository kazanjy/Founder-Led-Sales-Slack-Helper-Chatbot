-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('CHATBASE', 'DIRECT');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "mode" "ConversationMode" NOT NULL DEFAULT 'CHATBASE';
