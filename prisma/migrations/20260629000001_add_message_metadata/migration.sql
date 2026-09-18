-- Add a metadata column to Message so the unified web agent can stash
-- tool-call traces alongside the assistant reply (rendered as a
-- collapsible disclosure beneath the message in the chat UI). Nullable
-- so every existing row is unaffected.
ALTER TABLE "messages"
  ADD COLUMN "metadata" JSONB;
