/**
 * Discovery Call Review Rubric
 * Score each item: 0 = missed, 1 = partial, 2 = nailed
 */

export interface RubricItem {
  key: string;
  label: string;
  scoringGuide: {
    "0": string;
    "1": string;
    "2": string;
  };
}

export interface RubricSection {
  key: string;
  label: string;
  maxScore: number;
  items: RubricItem[];
}

export interface RedFlag {
  key: string;
  label: string;
  detection: string;
}

export interface Rubric {
  sections: RubricSection[];
  redFlags: RedFlag[];
}

export const DISCOVERY_CALL_RUBRIC: Rubric = {
  sections: [
    {
      key: "preCallOpening",
      label: "A) Pre-call + Opening",
      maxScore: 14,
      items: [
        {
          key: "prepared",
          label: "References specific company/person research (not generic)",
          scoringGuide: {
            "0": "No research evident, generic opener",
            "1": "Mentions company name but nothing specific",
            "2": "References specific recent event, role detail, or company initiative",
          },
        },
        {
          key: "rapport",
          label: "Rapport: targeted, shows planning, not generic small talk",
          scoringGuide: {
            "0": "No rapport building, jumps straight to business",
            "1": "Generic small talk (weather, weekend, 'how are you')",
            "2": "Targeted rapport that shows planning — references something personal, specific, or clever about the prospect",
          },
        },
        {
          key: "humor",
          label: "Brings lightness: humor, warmth, or personality early in the call",
          scoringGuide: {
            "0": "No humor or warmth, purely transactional tone throughout",
            "1": "Some attempt at lightness but feels forced or one-note",
            "2": "Genuine humor, a playful comment, or warm personality that makes the conversation feel relaxed and human",
          },
        },
        {
          key: "timeCheck",
          label: "Time check: confirms end time",
          scoringGuide: {
            "0": "No mention of time",
            "1": "Vague time reference",
            "2": "Explicit time confirmation ('are we good til :30?')",
          },
        },
        {
          key: "agendaSet",
          label: "Agenda set: states what the call will cover and gets buy-in",
          scoringGuide: {
            "0": "No agenda, dives right in",
            "1": "Mentions what they'll cover but doesn't confirm with prospect",
            "2": "Clear agenda stated and confirmed ('does that work for you?' / 'anything you'd add?')",
          },
        },
        {
          key: "elevatorPitch",
          label: "Elevator pitch: concise, compelling 'what we do' (under 60 seconds)",
          scoringGuide: {
            "0": "No positioning statement, or rambling multi-minute pitch",
            "1": "Explains what they do but too long or too vague",
            "2": "Crisp, compelling positioning in under 60 seconds that connects to the prospect's world",
          },
        },
        {
          key: "transitionToDiscovery",
          label: "Smooth transition from opening to discovery questions",
          scoringGuide: {
            "0": "Abrupt shift or no clear transition",
            "1": "Awkward transition",
            "2": "Natural bridge from pitch/agenda into first discovery question",
          },
        },
      ],
    },
    {
      key: "discoveryExecution",
      label: "B) Discovery Execution Quality",
      maxScore: 28,
      items: [
        {
          key: "currentState",
          label: "Starts with current state ('how do you do X today?')",
          scoringGuide: {
            "0": "Never asks about current state",
            "1": "Briefly touches on current state",
            "2": "Opens discovery with clear current-state questions",
          },
        },
        {
          key: "pullsThread",
          label: "Pulls the thread: asks 2nd/3rd-level follow-ups",
          scoringGuide: {
            "0": "One-and-done questions throughout",
            "1": "Occasionally follows up but mostly surface-level",
            "2": "Consistently digs deeper with follow-up questions",
          },
        },
        {
          key: "specificExamples",
          label: "Gets at least one concrete recent instance/story",
          scoringGuide: {
            "0": "No specific examples obtained",
            "1": "Gets a vague example",
            "2": "Gets a concrete, recent, specific story or instance",
          },
        },
        {
          key: "painExplicit",
          label: "Pain is explicit: stated in prospect's words",
          scoringGuide: {
            "0": "Pain is assumed or never surfaced",
            "1": "Rep states the pain, prospect agrees",
            "2": "Prospect articulates the pain in their own words",
          },
        },
        {
          key: "painSized",
          label: "Pain is sized: frequency/volume (per day/week/month)",
          scoringGuide: {
            "0": "No quantification attempted",
            "1": "Vague sizing ('a lot', 'frequently')",
            "2": "Specific frequency/volume numbers obtained",
          },
        },
        {
          key: "impactSized",
          label: "Impact is sized: time/$/risk/headcount or KPI impact",
          scoringGuide: {
            "0": "No impact discussion",
            "1": "Qualitative impact ('it's costly')",
            "2": "Quantified impact with numbers or ranges",
          },
        },
        {
          key: "whyNow",
          label: "Why now: trigger event / urgency / cost of inaction",
          scoringGuide: {
            "0": "No urgency discussion",
            "1": "Vague sense of timing",
            "2": "Clear trigger event or cost of inaction identified",
          },
        },
        {
          key: "priorityCheck",
          label: "Priority check: where this sits vs other initiatives",
          scoringGuide: {
            "0": "Not discussed",
            "1": "Briefly mentioned",
            "2": "Clearly established relative priority",
          },
        },
        {
          key: "currentAlternatives",
          label: "Current alternatives: tools/workarounds/vendors + why insufficient",
          scoringGuide: {
            "0": "Not explored",
            "1": "Knows they use something but not why it's insufficient",
            "2": "Full picture of current solutions and their shortcomings",
          },
        },
        {
          key: "successDefinition",
          label: "Success definition: what 'better' looks like + measurable outcomes",
          scoringGuide: {
            "0": "Not discussed",
            "1": "Vague vision of better",
            "2": "Clear, measurable definition of success",
          },
        },
        {
          key: "stakeholders",
          label: "Stakeholders: who uses / who signs / who blocks",
          scoringGuide: {
            "0": "Not discussed",
            "1": "Knows the signer but not the full picture",
            "2": "Mapped users, decision-maker, and potential blockers",
          },
        },
        {
          key: "buyingProcess",
          label: "Process: next steps in their buying process",
          scoringGuide: {
            "0": "Not discussed",
            "1": "Vague understanding",
            "2": "Clear picture of security, legal, procurement steps",
          },
        },
        {
          key: "disqualifies",
          label: "Disqualifies when appropriate (doesn't force-fit)",
          scoringGuide: {
            "0": "Force-fits solution despite poor fit signals",
            "1": "Acknowledges misfit but pushes forward",
            "2": "Appropriately qualifies/disqualifies based on fit",
          },
        },
        {
          key: "conversationFeel",
          label: "Conversation feel: 'beers test' (peer-to-peer, not interrogation)",
          scoringGuide: {
            "0": "Feels like an interrogation or scripted pitch",
            "1": "Professional but stiff",
            "2": "Natural, peer-to-peer conversation flow",
          },
        },
      ],
    },
    {
      key: "relevancePivot",
      label: "C) Relevance Pivot",
      maxScore: 12,
      items: [
        {
          key: "summarizesBack",
          label: "Summarizes back: crisp recap of pains + impact",
          scoringGuide: {
            "0": "No summary, jumps to pitch",
            "1": "Partial recap",
            "2": "Crisp 'here's what I heard...' recap before pivoting",
          },
        },
        {
          key: "asksPermission",
          label: "Asks permission to show ('can I show you how we handle that?')",
          scoringGuide: {
            "0": "Launches into demo/pitch without asking",
            "1": "Weak transition",
            "2": "Explicit permission ask before showing anything",
          },
        },
        {
          key: "showsRelevant",
          label: "Shows only relevant content (doesn't march through full deck)",
          scoringGuide: {
            "0": "Full deck/demo walkthrough regardless of discovery",
            "1": "Mostly relevant but includes some generic content",
            "2": "Laser-focused on discovered pains only",
          },
        },
        {
          key: "connectsFeaturesToPain",
          label: "Connects features to pain explicitly",
          scoringGuide: {
            "0": "Random feature tour",
            "1": "Some connections made",
            "2": "Every feature shown is explicitly tied to a stated pain",
          },
        },
        {
          key: "comprehensionChecks",
          label: "Comprehension check-ins during walkthrough",
          scoringGuide: {
            "0": "No check-ins, monologue",
            "1": "Occasional 'does that make sense?'",
            "2": "Regular meaningful check-ins that invite dialogue",
          },
        },
        {
          key: "trialCloses",
          label: "Trial closes: validates resonance",
          scoringGuide: {
            "0": "No validation of resonance",
            "1": "One check at the end",
            "2": "Regular trial closes throughout ('is this the kind of thing you meant?')",
          },
        },
      ],
    },
    {
      key: "closeNextStep",
      label: "D) Close + Next Step",
      maxScore: 16,
      items: [
        {
          key: "reservesTime",
          label: "Reserves time to close (doesn't run out the clock)",
          scoringGuide: {
            "0": "Runs out of time, rushed ending",
            "1": "Leaves some time but feels hurried",
            "2": "Clearly reserves 5+ minutes for close",
          },
        },
        {
          key: "clearDecision",
          label: "Clear mutual decision: advance or part ways as friends",
          scoringGuide: {
            "0": "Ambiguous ending",
            "1": "Rep pushes for next step without mutual agreement",
            "2": "Clear mutual decision to advance or not",
          },
        },
        {
          key: "avoidsWeakClose",
          label: "Avoids weak close ('let me know what you think' = fail)",
          scoringGuide: {
            "0": "'Let me know what you think' or similar",
            "1": "Suggests next step but doesn't lock it",
            "2": "Strong, specific close with no ambiguity",
          },
        },
        {
          key: "concreteNextStep",
          label: "Next step is concrete: meeting booked with date/time",
          scoringGuide: {
            "0": "No next step or vague 'I'll follow up'",
            "1": "Agrees to meet again but no date set",
            "2": "Meeting booked on calendar before hanging up",
          },
        },
        {
          key: "nextStepPurpose",
          label: "Next step has purpose: what will be decided/produced",
          scoringGuide: {
            "0": "No agenda for next meeting",
            "1": "Vague purpose",
            "2": "Clear purpose and expected outcome for next call",
          },
        },
        {
          key: "homeworkAssigned",
          label: "Homework assigned: both sides (data, attendees, docs)",
          scoringGuide: {
            "0": "No homework for either side",
            "1": "One-sided homework only",
            "2": "Both sides have clear action items",
          },
        },
        {
          key: "confirmsStakeholders",
          label: "Confirms stakeholders for next step",
          scoringGuide: {
            "0": "Not discussed",
            "1": "Vague 'bring your team'",
            "2": "Specific people identified for next meeting",
          },
        },
        {
          key: "recapFollowUp",
          label: "Recap: verbal recap + commits to follow-up email",
          scoringGuide: {
            "0": "No recap, no follow-up commitment",
            "1": "Brief recap or follow-up mention",
            "2": "Clear verbal recap and explicit follow-up email commitment",
          },
        },
      ],
    },
  ],
  redFlags: [
    {
      key: "demoFirst",
      label: "Demo-first with no discovery",
      detection: "Rep shows product/deck before asking discovery questions",
    },
    {
      key: "prospectTalkTimeLow",
      label: "Prospect talks <40% of the time",
      detection: "Estimated prospect talk time is below 40%",
    },
    {
      key: "noQuantifiedImpact",
      label: "No quantified impact attempt",
      detection: "Rep never attempts to size the pain or impact with numbers",
    },
    {
      key: "noBuyingProcess",
      label: "No buying process discussion",
      detection: "No mention of procurement, legal, security, or decision process",
    },
    {
      key: "noScheduledNextStep",
      label: "Ends without a scheduled next step",
      detection: "Call ends without a concrete meeting booked on calendar",
    },
  ],
};

/**
 * Calculate overall score from scored items
 */
export function calculateOverallScore(scores: {
  sections: Record<string, { items: Record<string, { score: number }> }>;
}): { overall: number; max: number } {
  let overall = 0;
  let max = 0;

  for (const section of DISCOVERY_CALL_RUBRIC.sections) {
    max += section.maxScore;
    const sectionScores = scores.sections[section.key];
    if (sectionScores) {
      for (const item of section.items) {
        const itemScore = sectionScores.items[item.key];
        if (itemScore) {
          overall += itemScore.score;
        }
      }
    }
  }

  return { overall, max };
}
