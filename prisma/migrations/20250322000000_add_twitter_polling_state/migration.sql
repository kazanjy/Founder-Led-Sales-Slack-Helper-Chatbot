-- Add Twitter polling state to global_settings
ALTER TABLE "global_settings" ADD COLUMN "twitterSinceId" TEXT;
ALTER TABLE "global_settings" ADD COLUMN "twitterLastPollAt" TIMESTAMP(3);
