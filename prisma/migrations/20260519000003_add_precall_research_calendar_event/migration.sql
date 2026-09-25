-- Persist a snapshot of the calendar event behind a pre-call
-- research brief so the Slack broadcast and report can show the
-- meeting context (time, attendees, description, location, meeting
-- URL) even if the source event later changes or is deleted.

ALTER TABLE "pre_call_research" ADD COLUMN "calendarEvent" JSONB;
