-- Add columns to persist dynamically-registered OAuth client credentials
-- for providers that use RFC 7591 dynamic client registration
-- (Circleback). Each user gets their own clientId/clientSecret at
-- connect time; we need to store them so the refresh flow can use them
-- later. Nullable so providers with static clientIds (Fathom) are
-- unaffected.
ALTER TABLE "meeting_recorder_connections"
  ADD COLUMN "providerClientId" TEXT,
  ADD COLUMN "providerClientSecret" TEXT;
