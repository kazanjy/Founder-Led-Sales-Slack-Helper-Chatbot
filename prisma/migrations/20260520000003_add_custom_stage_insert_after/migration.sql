-- Position custom stages relative to the built-in pipeline. A row
-- with insertAfter = "demo" renders between Demo and Proposal.
-- Null = appended at the end (current behavior).

ALTER TABLE "custom_deal_stages" ADD COLUMN "insertAfter" TEXT;
