import { openai } from "@/lib/openai";
import { DISCOVERY_CALL_RUBRIC } from "./rubric";

export interface ScoreItem {
  score: number;
  evidence: string;
  overridden: boolean;
}

export interface SectionScores {
  items: Record<string, ScoreItem>;
}

export interface RedFlagResult {
  triggered: boolean;
  note: string;
}

export interface AnalysisResult {
  sections: Record<string, SectionScores>;
  redFlags: Record<string, RedFlagResult>;
  summary: string;
  topStrength: string;
  topImprovement: string;
  repName: string;
  prospectCompany: string;
  talkTime: {
    participants: { name: string; role: "rep" | "prospect" | "other"; percentage: number }[];
    repPercentage: number;
    prospectPercentage: number;
    assessment: string;
  };
}

/**
 * Analyze a call transcript against the discovery call rubric using GPT 5.2
 */
export async function analyzeCallTranscript(
  transcript: string,
  discoveryQuestions?: string | null,
  firstCallChecklist?: string | null,
  salesNarrative?: string | null,
): Promise<AnalysisResult> {
  // Build the rubric description for the prompt
  const rubricDescription = DISCOVERY_CALL_RUBRIC.sections.map((section) => {
    const items = section.items
      .map(
        (item) =>
          `  - "${item.key}": ${item.label}\n    0 = ${item.scoringGuide["0"]}\n    1 = ${item.scoringGuide["1"]}\n    2 = ${item.scoringGuide["2"]}`,
      )
      .join("\n");
    return `### ${section.label} (max ${section.maxScore} points)\n${items}`;
  }).join("\n\n");

  const redFlagDescription = DISCOVERY_CALL_RUBRIC.redFlags
    .map((rf) => `- "${rf.key}": ${rf.label} — ${rf.detection}`)
    .join("\n");

  let contextSection = "";
  if (discoveryQuestions) {
    contextSection += `\n\n## USER'S DISCOVERY QUESTIONS (for reference — check if the rep asked these):\n\n${discoveryQuestions}`;
  }
  if (firstCallChecklist) {
    contextSection += `\n\n## USER'S FIRST CALL CHECKLIST (expected call structure and flow):\n\n${firstCallChecklist.substring(0, 5000)}`;
  }
  if (salesNarrative) {
    contextSection += `\n\n## USER'S SALES NARRATIVE (for context on what they sell):\n\n${salesNarrative.substring(0, 3000)}`;
  }

  const systemPrompt = `You are an expert sales call reviewer analyzing a discovery call transcript. Score the call against the rubric below.

## SCORING RUBRIC

${rubricDescription}

## RED FLAGS (auto-dings)

${redFlagDescription}

## INSTRUCTIONS

1. Read the full transcript carefully
2. Score EVERY item in EVERY section (0, 1, or 2)
3. For each score, provide a brief evidence quote or observation from the transcript
4. Check each red flag — mark as triggered (true/false) with a note
5. Write a 2-3 sentence overall summary
6. Identify the top strength and top area for improvement
7. Extract the sales rep's name and the prospect's company name from the transcript
8. Analyze talk time: identify all participants, their roles (rep/prospect/other), and estimate each person's percentage of total talk time based on transcript length and speaking turns. Calculate the total rep percentage and total prospect percentage (all prospects combined). Provide a brief assessment of the talk time balance (ideal is rep ~40%, prospects ~60%).
${contextSection}

## REQUIRED OUTPUT FORMAT

Return ONLY valid JSON matching this exact structure (no markdown, no code blocks):

{
  "sections": {
    "preCallOpening": {
      "items": {
        "prepared": { "score": 0, "evidence": "..." },
        "rapport": { "score": 0, "evidence": "..." },
        "humor": { "score": 0, "evidence": "..." },
        "timeCheck": { "score": 0, "evidence": "..." },
        "agendaSet": { "score": 0, "evidence": "..." },
        "elevatorPitch": { "score": 0, "evidence": "..." },
        "transitionToDiscovery": { "score": 0, "evidence": "..." }
      }
    },
    "discoveryExecution": {
      "items": {
        "currentState": { "score": 0, "evidence": "..." },
        "pullsThread": { "score": 0, "evidence": "..." },
        "specificExamples": { "score": 0, "evidence": "..." },
        "painExplicit": { "score": 0, "evidence": "..." },
        "painSized": { "score": 0, "evidence": "..." },
        "impactSized": { "score": 0, "evidence": "..." },
        "whyNow": { "score": 0, "evidence": "..." },
        "priorityCheck": { "score": 0, "evidence": "..." },
        "currentAlternatives": { "score": 0, "evidence": "..." },
        "successDefinition": { "score": 0, "evidence": "..." },
        "stakeholders": { "score": 0, "evidence": "..." },
        "buyingProcess": { "score": 0, "evidence": "..." },
        "disqualifies": { "score": 0, "evidence": "..." },
        "conversationFeel": { "score": 0, "evidence": "..." }
      }
    },
    "relevancePivot": {
      "items": {
        "summarizesBack": { "score": 0, "evidence": "..." },
        "asksPermission": { "score": 0, "evidence": "..." },
        "showsRelevant": { "score": 0, "evidence": "..." },
        "connectsFeaturesToPain": { "score": 0, "evidence": "..." },
        "comprehensionChecks": { "score": 0, "evidence": "..." },
        "trialCloses": { "score": 0, "evidence": "..." }
      }
    },
    "closeNextStep": {
      "items": {
        "reservesTime": { "score": 0, "evidence": "..." },
        "clearDecision": { "score": 0, "evidence": "..." },
        "avoidsWeakClose": { "score": 0, "evidence": "..." },
        "concreteNextStep": { "score": 0, "evidence": "..." },
        "nextStepPurpose": { "score": 0, "evidence": "..." },
        "homeworkAssigned": { "score": 0, "evidence": "..." },
        "confirmsStakeholders": { "score": 0, "evidence": "..." },
        "recapFollowUp": { "score": 0, "evidence": "..." }
      }
    }
  },
  "redFlags": {
    "demoFirst": { "triggered": false, "note": "..." },
    "prospectTalkTimeLow": { "triggered": false, "note": "..." },
    "noQuantifiedImpact": { "triggered": false, "note": "..." },
    "noBuyingProcess": { "triggered": false, "note": "..." },
    "noScheduledNextStep": { "triggered": false, "note": "..." }
  },
  "summary": "2-3 sentence overall assessment",
  "topStrength": "The single biggest strength",
  "topImprovement": "The single biggest area for improvement",
  "repName": "The sales rep's name (or 'Unknown' if not identifiable)",
  "prospectCompany": "The prospect's company name (or 'Unknown' if not identifiable)",
  "talkTime": {
    "participants": [
      { "name": "Rep Name", "role": "rep", "percentage": 42 },
      { "name": "Prospect Name", "role": "prospect", "percentage": 58 }
    ],
    "repPercentage": 42,
    "prospectPercentage": 58,
    "assessment": "Brief assessment of talk time balance"
  }
}`;

  const systemPromptLen = systemPrompt.length;
  const userPromptLen = transcript.length + 40; // "Here is the call transcript to review:\n\n"
  console.log("[CallReview:analyze] Calling GPT-5.2 | system prompt:", systemPromptLen, "chars | user prompt:", userPromptLen, "chars | total:", systemPromptLen + userPromptLen, "chars");

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Here is the call transcript to review:\n\n${transcript}` },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  console.log("[CallReview:analyze] GPT response received | usage:", JSON.stringify(response.usage || {}));

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.error("[CallReview:analyze] No content in GPT response | finish_reason:", response.choices[0]?.finish_reason);
    throw new Error("No response from AI");
  }

  console.log("[CallReview:analyze] Parsing JSON response |", content.length, "chars");
  let result: AnalysisResult;
  try {
    result = JSON.parse(content) as AnalysisResult;
  } catch (parseError) {
    console.error("[CallReview:analyze] JSON parse failed | first 500 chars:", content.substring(0, 500));
    throw new Error("AI returned invalid JSON. Please try again.");
  }

  // Add overridden: false to all items
  for (const sectionKey of Object.keys(result.sections)) {
    for (const itemKey of Object.keys(result.sections[sectionKey].items)) {
      result.sections[sectionKey].items[itemKey].overridden = false;
    }
  }

  return result;
}
