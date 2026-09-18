-- Role-typed hiring profiles: AE, SDR, CSM.
--
-- Vercel does not run migrations, so this is the hand-run equivalent of
-- prisma/migrations/20260817000001_hiring_profile_role_types PLUS the
-- question banks that scripts/seed-role-hiring-profile-questions.ts
-- would otherwise insert. Run the whole file in the Supabase SQL editor.
--
-- Safe to re-run. Every statement is guarded, and the seed upserts on
-- (roleType, globalOrder), so a second run repairs drift rather than
-- duplicating rows. It never touches the AE bank.

BEGIN;

-- ── Schema ────────────────────────────────────────────────────────
-- Everything already in these tables is an AE profile, so the DEFAULT
-- backfills existing rows correctly and behaviour is unchanged until a
-- second role is seeded below.

ALTER TABLE "hiring_profile_questions"
  ADD COLUMN IF NOT EXISTS "roleType" TEXT NOT NULL DEFAULT 'AE';

ALTER TABLE "hiring_profile_versions"
  ADD COLUMN IF NOT EXISTS "roleType" TEXT NOT NULL DEFAULT 'AE';

-- globalOrder was globally unique, which allowed exactly one question
-- bank. Each role numbers its own questions from 1, so the constraint
-- has to become composite or the SDR seed collides with the AE bank.
ALTER TABLE "hiring_profile_questions"
  DROP CONSTRAINT IF EXISTS "hiring_profile_questions_globalOrder_key";

CREATE UNIQUE INDEX IF NOT EXISTS "hiring_profile_questions_roleType_globalOrder_key"
  ON "hiring_profile_questions" ("roleType", "globalOrder");

CREATE INDEX IF NOT EXISTS "hiring_profile_questions_roleType_globalOrder_idx"
  ON "hiring_profile_questions" ("roleType", "globalOrder");

-- The assessor looks up "latest profile for this account and seat".
CREATE INDEX IF NOT EXISTS "hiring_profile_versions_userId_roleType_createdAt_idx"
  ON "hiring_profile_versions" ("userId", "roleType", "createdAt");

-- ── Question banks ────────────────────────────────────────────────

-- SDR question bank (25 questions)
INSERT INTO "hiring_profile_questions"
  ("id", "roleType", "globalOrder", "category", "question", "helpText", "enabled", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'SDR', 1, 'Company Stage & Context', 'Has the founder personally booked meetings with cold outbound in the last 90 days?', 'The single best predictor of whether an SDR will succeed. If the founder can''t book meetings with the current message, an SDR won''t either — they''ll just fail more expensively', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 2, 'Company Stage & Context', 'What''s the current meeting-to-opportunity rate, and who is running those meetings?', 'If meetings don''t convert, more meetings isn''t the fix', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 3, 'Company Stage & Context', 'Is the ICP locked, or is this hire partly to help figure out who buys?', 'An SDR can test a hypothesis; they can''t invent one', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 4, 'Company Stage & Context', 'What does success at 90 days look like — in meetings, opportunities, or pipeline dollars?', 'Pick one primary number. Reps optimize for whatever you actually measure', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 5, 'Pipeline Generation & Channels', 'Which channels are working today: cold call, email, LinkedIn, events, referrals?', 'Rank them by meetings actually produced, not by effort spent', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 6, 'Pipeline Generation & Channels', 'Will this SDR be expected to cold call, and roughly how many dials a day?', 'Be honest here — phone-averse candidates are common and it is much easier to screen for than to fix', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 7, 'Pipeline Generation & Channels', 'Is there a working sequence today, or does the SDR build it?', 'Running a proven sequence and writing one from scratch are different jobs and different hires', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 8, 'Pipeline Generation & Channels', 'Who owns list building and data — the SDR, ops, or a vendor?', 'An SDR spending half their week building lists books roughly half the meetings', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 9, 'Pipeline Generation & Channels', 'How much personalization is expected per touch?', 'Deep research on 20 accounts a day is a different role from 150 semi-personalized touches', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 10, 'Target & Message', 'Who exactly are they prospecting into — title, seniority, company size, industry?', 'Specific enough that the SDR could build the list themselves from it', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 11, 'Target & Message', 'How technical is the buyer, and how technical does the SDR need to sound?', 'Selling to platform engineers has a much higher credibility floor than selling to office managers', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 12, 'Target & Message', 'What objection kills the most conversations at the top of the funnel?', 'Whatever it is, the SDR will hear it fifty times a week — screen for how they handle it', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 13, 'Target & Message', 'Can the SDR change the messaging, or do they run what''s given to them?', 'Autonomy here changes both the seniority you need and the interview questions', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 14, 'Activity & Metrics', 'What are the daily/weekly activity expectations, and are they enforced?', 'An unenforced number is a wish. Say what actually gets inspected', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 15, 'Activity & Metrics', 'How is the SDR compensated — base, variable, and on what trigger?', 'Meetings booked, meetings held, or opportunities accepted. Each produces different behaviour', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 16, 'Activity & Metrics', 'What happens to a meeting that gets booked and then no-shows?', 'Whether it counts determines how carefully the SDR qualifies before booking', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 17, 'Role Scope & Ramp', 'Is this a pure SDR seat, or SDR-to-AE with a defined promotion path?', 'The best early SDRs almost always want the path. Vague answers here lose candidates', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 18, 'Role Scope & Ramp', 'How long until you expect them to be at full activity? At full quota?', 'Separate the two — ramping activity is weeks, ramping conversion is months', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 19, 'Role Scope & Ramp', 'Will they sit on discovery calls, or hand off at the meeting?', 'Attending calls is how an SDR learns the buyer, and how you find out if they can become an AE', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 20, 'Role Scope & Ramp', 'Is this the first SDR, or joining an existing team?', 'A first SDR has no peer to learn from and needs far more self-direction', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 21, 'Coaching & Management', 'Who coaches this person, and how many hours a week can they genuinely give?', 'SDRs are the most coaching-dependent seat in sales. Be realistic rather than aspirational', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 22, 'Coaching & Management', 'Who listens to their calls, and how often?', 'Call review is the mechanism. If nobody has time for it, hire more experience instead', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 23, 'Coaching & Management', 'What tooling exists — CRM, sequencer, dialer, data, call recording?', 'Missing tooling shifts weeks of setup onto the new hire', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 24, 'Candidate Bar', 'Would you hire someone with no SDR experience but obvious hunger and coachability?', 'Phonathon, Cutco/Vector, door-to-door, competitive athletics and hospitality all predict well for this seat', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'SDR', 25, 'Candidate Bar', 'What would make you pass on an otherwise strong candidate?', 'Name the disqualifiers explicitly so the screen is consistent across candidates', true, NOW(), NOW())
ON CONFLICT ("roleType", "globalOrder") DO UPDATE SET
  "category"  = EXCLUDED."category",
  "question"  = EXCLUDED."question",
  "helpText"  = EXCLUDED."helpText",
  "enabled"   = true,
  "updatedAt" = NOW();

-- CSM question bank (25 questions)
INSERT INTO "hiring_profile_questions"
  ("id", "roleType", "globalOrder", "category", "question", "helpText", "enabled", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'CSM', 1, 'Company Stage & Context', 'How many customers are there today, and how many will there be in 12 months?', 'Sets the account load, which drives whether this is a high-touch or scaled seat', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 2, 'Company Stage & Context', 'What''s current gross and net retention, and do you trust the numbers?', 'If you can''t measure churn yet, the first job of this hire may be to instrument it', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 3, 'Company Stage & Context', 'Who does customer success today, and what breaks when they stop?', 'Usually the founder. Naming what breaks defines the job better than any title does', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 4, 'Company Stage & Context', 'What does success at 6 months look like — retention, adoption, expansion, or NPS?', 'Pick the primary one. A CSM measured on everything is measured on nothing', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 5, 'What This Seat Actually Is', 'Is this a quota-carrying seat? Does it own renewals, expansion, both, or neither?', 'The most important question in this profile. A CSM who owns a number and one who doesn''t are different hires from different candidate pools', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 6, 'What This Seat Actually Is', 'What percentage of the week is reactive support versus proactive account work?', 'Be honest. Candidates who wanted strategy and got a ticket queue leave inside a year', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 7, 'What This Seat Actually Is', 'Who owns onboarding and implementation — this person, or someone else?', 'Implementation is a distinct skill set and often a distinct hire', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 8, 'What This Seat Actually Is', 'Does this person handle escalations and bugs, or route them?', 'Determines how technical they need to be and how much of their week is unplanned', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 9, 'Customer Base & Segments', 'What''s the ACV range, and how many accounts will one CSM carry?', '20 accounts at $100k and 300 at $6k are unrelated jobs', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 10, 'Customer Base & Segments', 'Who is the day-to-day user, and who holds the budget?', 'When these differ, the CSM''s real job is keeping the budget holder aware of value', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 11, 'Customer Base & Segments', 'How sophisticated are your customers about this problem?', 'Teaching a category is a different job from optimizing within a known one', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 12, 'Customer Base & Segments', 'Which customer segment churns most, and do you know why?', 'The answer usually describes the hire''s first quarter', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 13, 'Onboarding & Adoption', 'What does onboarding look like today, and how long does time-to-value take?', 'Documented and repeatable, or reinvented per customer?', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 14, 'Onboarding & Adoption', 'What does a healthy account look like in product usage terms?', 'If nobody can answer this, the CSM cannot spot risk before the renewal call', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 15, 'Onboarding & Adoption', 'How technical is implementation — SDK, API, integrations, data migration?', 'Sets the technical floor and whether they need an SE beside them', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 16, 'Onboarding & Adoption', 'Will this person build the playbooks and materials, or run existing ones?', 'Building from nothing at an early stage is a builder profile, not an operator profile', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 17, 'Retention & Expansion', 'How are renewals handled today — auto-renew, formal process, or ad hoc?', 'Determines how much commercial muscle the hire needs', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 18, 'Retention & Expansion', 'Where does expansion revenue come from — seats, usage, new teams, upsell tiers?', 'Expansion motions differ enough that the right candidate differs too', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 19, 'Retention & Expansion', 'Is this person expected to run a commercial conversation, including price?', 'Many strong CSMs have never negotiated. Screen for it if you need it', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 20, 'Retention & Expansion', 'Who do they hand a churn risk to, and how early?', 'Escalation paths that only exist in someone''s head don''t get used', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 21, 'Role Scope & Ramp', 'Is this the first CS hire, or joining an existing function?', 'A first CSM inherits every unwritten process the founder has been carrying', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 22, 'Role Scope & Ramp', 'What tooling exists — CRM, support desk, product analytics, health scoring?', 'Absent tooling means the first quarter is instrumentation, not customers', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 23, 'Role Scope & Ramp', 'How much of the role is cross-functional — product feedback, roadmap, marketing?', 'Early CS is often the loudest voice of the customer inside the company', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 24, 'Candidate Bar', 'Would you take a strong support or implementation background over CSM-titled experience?', 'Title matters far less than whether they''ve done the work this seat actually contains', true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CSM', 25, 'Candidate Bar', 'What would make you pass on an otherwise strong candidate?', 'Name the disqualifiers explicitly so the screen is consistent across candidates', true, NOW(), NOW())
ON CONFLICT ("roleType", "globalOrder") DO UPDATE SET
  "category"  = EXCLUDED."category",
  "question"  = EXCLUDED."question",
  "helpText"  = EXCLUDED."helpText",
  "enabled"   = true,
  "updatedAt" = NOW();

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────
-- Expect: AE = your existing count, SDR = 25, CSM = 25.
SELECT "roleType", COUNT(*) AS questions
FROM "hiring_profile_questions"
GROUP BY "roleType"
ORDER BY "roleType";
