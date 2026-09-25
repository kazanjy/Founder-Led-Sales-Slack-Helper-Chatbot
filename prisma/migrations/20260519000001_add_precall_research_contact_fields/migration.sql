-- Capture the prospect's email and LinkedIn URL on each research
-- brief so the report can show a header card with all the human
-- context (name, title, company, LinkedIn, email) at the top.
-- Nullable because legacy briefs and Slack-sourced briefs may not
-- have these populated.

ALTER TABLE "pre_call_research" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "pre_call_research" ADD COLUMN "contactLinkedIn" TEXT;
