# Candidate Flag Rubric — Prose Definition

A description of every signal MikeyBot's candidate assessor looks for, and how
each is arrived at, written so that a capable model could perform the whole
evaluation from this document alone. In the product these are computed
deterministically in TypeScript and the model only narrates them; this is the
same body of judgment rendered as instructions.

---

## What a flag is

A flag is an evidence-backed prompt for a conversation, never a verdict about a
person. Each one is a claim you can point at specific dates and employers to
justify, paired with why it matters for this particular hire. If you cannot name
the months and the companies behind an observation, it is not a flag — it is an
impression, and it belongs in your interview questions or your list of things
you could not establish.

Every flag carries four properties. Its **polarity** is positive or negative;
positive flags are first-class findings, not merely the absence of negative ones.
Its **severity** ranges from low through medium and high to critical, and the
report is ordered by it, because not every finding deserves equal weight on the
page. Its **confidence** is either firm or approximate: firm when the underlying
dates are precise to the month and the company was identified unambiguously,
approximate when the reasoning rests on year-only dates or a fuzzy match to a
company name. And a flag may be **discounted**, which does not mean deleted — a
discounted flag still appears, with its reason shown, because silently filtering
findings is what makes the surviving ones untrustworthy.

---

## Rules that govern everything below

**Tenure is measured per employer, never per role.** Someone who spent twelve
months as a Corporate AE and seventeen as a Mid-Market AE at the same company
had a twenty-nine month tenure with a promotion in it. Counting those as two
short stints turns a healthy record into a chronic pattern, which is the worst
mistake this evaluation can make. Sum all roles at one employer before you judge
the length of anything.

**A job someone still holds is not a stint.** They have not left it. Counting
the current role as evidence of instability is the easiest way to libel a
candidate who simply started recently.

**Student and early-career work is excluded from every negative tenure
observation.** A student waits tables one summer, runs a fraternity chapter, and
works part-time somewhere — three overlapping engagements and two gaps, none of
which say anything about whether they will carry a quota. Running instability
rules over that material manufactures findings out of an ordinary undergraduate
life, and because early-career candidates have nothing else on the page, all the
damage lands on the youngest applicants. Treat as student work anything whose
title or employer indicates an internship, campus role, part-time or seasonal
job, teaching or research assistantship, hospitality, retail, tutoring, camp or
lifeguarding work, a fraternity or sorority, or a student government or club
office.

**Negative observations about instability apply only to sales roles.** Scoping by
"was this a selling job" is more robust than trying to enumerate every
non-sales job a twenty-year-old might hold; the enumeration always misses one,
and the miss becomes a false finding. A gap between two selling jobs is worth a
question. A gap after a kitchen job is not, and neither is one that brackets a
degree.

**Thresholds are relative to the seat.** What counts as a short stint depends on
the cycle the role has to complete. For a development rep, under twelve months
is short. For a closing rep, an account manager, a customer success manager or a
front-line manager, under eighteen months is short. For a VP, under twenty-four
months is short. Applying the closer's bar to a development rep would flag
essentially every one of them, since median tenure in that seat genuinely sits
near fourteen months — that is the market, not a defect.

Assume a ramp when reasoning about how much selling a stint actually contained:
roughly two months for a development rep, three for an account manager or
customer success manager, four for a closer, five for a manager and six for a
VP. Always label the ramp as an assumption rather than a fact.

---

## Negative signals

### Serial short tenure

Look at each employer the candidate has left in the last six years, sum their
time there, and count how many of those employers they left inside the
short-stint threshold for the seat. **Two is a pattern. Four or more is a
disaster** — three for a VP, where the seat is rarer and each move costs more.

This is the most predictive negative signal on a sales résumé, and it is treated
more harshly than anything else here. A rep who leaves before a full quota year
never produces, and the employer pays the ramp twice. State the count, name the
companies, and show how little selling the pattern actually contained after ramp
— four sub-eight-month stints is about nineteen months of real selling time, and
that number lands harder than the count does.

Two rules make this deliberately unforgiving. **A downturn does not excuse it.**
A mass-layoff window explains one exit; it does not explain a career of them. Say
which stints ended during a known downturn, as context, and let the count stand
regardless. And **offer no innocent explanation.** Everywhere else in this
rubric a benign reading is mandatory; here it is forbidden. Softening a tenure
pattern with a hypothetical is how a hiring manager talks themselves into a bad
hire. If the candidate has an explanation, they can give it in the interview —
the job here is to make sure the interview actually happens.

### Departures just before the number would show

Separately, count the employers left after ten to fourteen months. Two or more
of those is the same instability seen more precisely: each exit lands at exactly
the point where a full quota year would have become visible. Hold it to the same
no-excuses standard.

### Washing out of a high-bar organization

Some organizations select hard, train hard and cut fast, so surviving one is
third-party validation. Leaving one inside twelve months is the inverse. Two
qualifications matter. First, the organization must have been high-bar **during
the years the candidate was there** — a company's reputation has a window, and
crediting or debiting someone for a decade they missed is the most common way a
list of good companies misleads. Second, unlike serial hopping, a single such
exit landing in a known layoff window genuinely is discountable; show it as
considered and set aside.

### Seniority moving downward

Order the candidate's professional selling roles chronologically and compare the
first to the last on two independent ladders. The seniority ladder runs from
development rep through closer, senior or enterprise closer, manager, director,
VP and executive. The segment ladder runs from SMB through commercial or
corporate, mid-market, enterprise and strategic or major accounts. A drop of more
than one rung on seniority, **with no compensating rise in segment**, is worth
raising.

Exclude founder, owner and chief-executive titles from this comparison entirely.
Someone who ran a small business before entering professional sales sits at the
top of the seniority ladder by title, so the ordinary and healthy progression
that follows — SMB closer, then corporate, then mid-market — reads as a collapse.
It is the opposite: they chose a real quota over a title they granted
themselves.

### Never promoted anywhere

If the candidate has two or more stints of thirty months or longer and no title
ever changed within any single employer, that is worth a question. Long tenure
without advancement is a different signal from long tenure with it.

### Unexplained gaps between selling jobs

A gap of more than six months between two professional selling roles is worth
noting, at low severity. Discount it when the prior stint ended during a known
downturn. Career breaks are never a finding.

### Title inflation

A VP or chief title at a company of roughly fewer than fifteen people, or at
pre-seed or seed stage, usually describes an individual contributor with a
generous title rather than someone who built and ran a team. Mark this
approximate — headcount at the time is rarely knowable precisely — and ask how
many people reported to them and whether they carried their own number.

### No quota-carrying role

If the history is sales-adjacent throughout — business development, partnerships,
growth, strategy, consulting — but never plainly quota-carrying, say so. It is a
different bet from hiring someone who has repeatedly owned a number.

### Repeated short consulting interludes

Two or more consulting, advisory or freelance engagements of under twelve months
sitting between full-time roles is worth understanding.

### Imprecise dates

If any role carries a year without a month, say so at low severity, and mark
every tenure-derived observation approximate. A year-only date silently becomes
January and can move a stint by as much as eleven months, which is enough to
manufacture or erase a pattern.

---

## Positive signals

Positive signals are genuine findings, not decoration. Two of them — early-stage
selling and background signals — follow a rule worth stating explicitly: **their
presence counts, and their absence counts for nothing.** There is no negative
counterpart. Most excellent candidates lack most of these, and turning an
absence into a penalty means the evaluation punishes the entire population it is
meant to distinguish within.

### Internal promotion

Someone promoted within a company — on either the seniority ladder or the segment
ladder — has been evaluated up close by people who saw the work, which is
validation no résumé claim can supply. This is the strongest single positive
signal available. Compare first role to last role chronologically, not best to
worst, or a demotion reads as a promotion. Moving off a quota-carrying seat into
a non-quota one is not a promotion, whatever the segment says, unless seniority
also rose. Student organizations are not employers; a fraternity office is not a
promotion.

### Long tenure across multiple roles

Three years or more at one employer across two or more roles means they were
kept, moved and re-bet on repeatedly. This is the counterweight to the
instability findings — an evaluation that can only ever punish tenure patterns
and never credit them is not measuring tenure, it is hunting for problems.

### Healthy tenure cadence

A median selling stint of thirty months or more is long enough to have ramped and
delivered full quota years repeatedly.

### Tenure at a high-bar organization

Eighteen months or more at an organization that was genuinely a training ground
**during those years** is a strong positive. Weight it by how canonical the
organization was: a famous talent factory reads differently from a
well-run-but-diluted one, and flattening the two makes the strong cases look
overstated.

Several qualifications ride along with this credit rather than being hidden
behind it. Where the sales role overlays enormous inbound or expansion demand,
cap the credit and say plainly that you would want evidence of self-sourced
pipeline before believing the numbers were theirs. Where the organization's
revenue came from concentrated, non-repeatable deals, award nothing. Where there
is documented evidence that the sales culture itself was poor despite commercial
success, the logo is not a positive at all — probe rather than credit. And where
the organization is too new to have proven itself as an academy, cap the credit
and revisit later.

Absence from any such list is neutral. Never being at a famous company is not a
finding.

### A coherent methodology lineage

Two or more employers, each held twelve months or more and each in its
high-quality era, that share a documented sales-methodology tradition indicates
someone deliberately trained in one coherent system rather than accumulating
habits. One such company is a coincidence; a chain is a fact about how they were
built.

### Selling at early stage

Having carried a bag at pre-seed, seed or Series A — for twelve months or more —
is the single most transferable thing on a résumé for an early-stage hire, and
should be credited strongly. Selling before the brand, the inbound, the
development reps and the sales engineer exist is the part of the job that
transfers least well from scale, and having already done it is the strongest
stage evidence available. If they joined that early and stayed while the company
grew into later rounds, that is stronger still and should be reported as one
finding rather than two overlapping ones.

**Stage is asymmetric and this matters enormously.** Its presence is a strong
positive; its absence is a note, not a penalty. Most good closers have never
worked at a seed company. A stage gap on its own must never produce a negative
overall verdict — it belongs in the interview questions and in the conditions
under which the hire works anyway. Reserve a weak stage rating for actual adverse
evidence, such as a candidate who says they need heavy support or a record
showing they only ever performed with it, never for missing evidence.

### Early-career selling crucibles

Two kinds of early work predict unusually well and should be credited strongly
even though they sit among the student roles otherwise excluded from negative
findings.

A **university fundraising call center** — a phonathon, annual fund, telefund or
student-caller role — is the best early-career sales signal there is. Hundreds of
cold calls a week asking strangers for money, against a tracked conversion rate,
with immediate and constant rejection. Nothing else available to a twenty-year-old
is closer to the actual job.

A **commission-only direct sales program** — the classic knife, book and
door-to-door outfits, along with pest control, alarm and solar canvassing — is
self-sourced, rejection-dense work that people opt into. Surviving a season of it
demonstrates more about prospecting temperament than most first sales jobs do.

### Background signals

These come from education and activities rather than the employment timeline.
Each is additive only; there is no path by which any of them lowers an
assessment, and their absence is never mentioned.

**Professional athletics** — including semi-professional, minor-league and
development systems, which are arguably the better signal since they involve the
same grind without the money — means clearing a selection funnel far narrower
than a varsity roster and then holding a job re-evaluated on measured performance
continuously and in public. It is the closest thing to a carried quota that
exists outside sales, and it is a different order of signal from collegiate
athletics. Credit whichever is higher, not both.

**Collegiate or competitive athletics** indicates sustained coachability,
performance against a scoreboard, and voluntary exposure to being cut. Captaincy
and walk-on status are the parts carrying the most signal.

**Military service** indicates performance under structure and pressure, with a
well-evidenced record in sales roles specifically.

**Carrying a multi-year achievement program to its terminal rank** — the top rank
in a scouting or equivalent youth program — represents years of self-directed work
toward a distant goal, which is the closest civilian analogue to working a long
sales cycle. Match on the achievement itself rather than on any one program's
name, since several such programs were historically restricted by sex and keying
on one of them makes the signal a proxy for something it must not measure.

**Having worked through school** is rated above every prestige signal here, and
deliberately so. It is earned rather than inherited, and it is the one background
signal that corrects for advantage rather than compounding it.

**Field of study** is weak evidence and should always be marked approximate. A
technical or hard-science degree suggests someone who can hold a technical
conversation with the buyer's engineers without a sales engineer present, which
matters most precisely where there is no sales engineer. An economics, finance or
accounting background suggests someone numerate enough to build a business case
and defend an ROI model. An argument-heavy humanities background suggests
comfort with structured persuasion under pressure.

**Academic distinction** — Latin honors, academic scholarships, an honors program,
a thesis with distinction — measures performance inside a program, which travels
further than admission to one.

**Attending a highly selective school** is credited, on the reasoning that a very
low admit rate is a hard, third-party-verified selection event. Weight a
single-digit admit bar above a merely competitive one. Note that unlike every
other signal here this is largely something that happened to a person at
seventeen rather than something they did, and that any list of selective schools
is a judgment call and unavoidably regional — so the absence of a recognizable
school name means nothing at all.

**Claimed top-percentile sales recognition** — President's Club, Winner's Circle,
a stated ranking — is worth noting but must always be marked unverified. It is a
résumé assertion, and the right response to it is a backchannel question rather
than belief.

---

## Reaching a verdict

Weight by severity, and discount anything marked approximate. Findings that were
discounted must not move the verdict, though they should still be shown with
their reason.

A critical instability pattern should drive the overall verdict to a likely
mismatch unless something genuinely extraordinary outweighs it, and the summary
must lead with the pattern rather than burying it beneath the candidate's
strengths.

Move the verdict downward only for facts about **this candidate** — a real
instability pattern, a hard requirement in the hiring bar that is genuinely
unmet, or a claim contradicted by their own timeline. Never move it downward
because of the population they came from. Not having worked at an early-stage
company, not having attended a selective school, not having played a sport and
not having a famous logo are all absences of positive evidence, and absence of
positive evidence is not negative evidence.

Every negative finding except the instability ones must be accompanied by a
genuine benign reading — not a throat-clear, but the explanation you would
actually expect to hear if you asked. A finding is a question to raise, and
raising it fairly means stating the innocent version alongside it.

---

## Constraints that are not negotiable

Judge the work: stage, motion, category, tenure, and demonstrated performance.

Never reason from a candidate's name, their location, or where they were born.
Career breaks are never a finding. Graduation years must never enter the
evaluation at all — they are a proxy for age, and age is a protected
characteristic; school and field of study are entirely readable without them.
Do not draw inferences from religious or political affiliation, or from anything
else naming a protected characteristic, even where it appears alongside a genuine
honor: take the award and leave the affiliation.

Where a company's stage or character could not be established with confidence, do
not assert it. Say that it could not be established. An honest gap is worth more
than a confident guess, because the reader cannot tell the difference between the
two unless you tell them.
