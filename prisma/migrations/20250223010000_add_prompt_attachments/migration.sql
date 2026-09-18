-- Add attachmentsIncluded to conversations table
ALTER TABLE "conversations" ADD COLUMN "attachmentsIncluded" JSONB;

-- Create user_attachment_preferences table
CREATE TABLE "user_attachment_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_attachment_preferences_pkey" PRIMARY KEY ("id")
);

-- Create unique index on userId
CREATE UNIQUE INDEX "user_attachment_preferences_userId_key" ON "user_attachment_preferences"("userId");

-- Add foreign key constraint
ALTER TABLE "user_attachment_preferences" ADD CONSTRAINT "user_attachment_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
