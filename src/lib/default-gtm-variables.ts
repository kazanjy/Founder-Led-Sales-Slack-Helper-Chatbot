// Default GTM Variables that ship with the app
// These are the core variables users should define for their business

export interface DefaultGtmVariable {
  id: string;
  name: string;
  mergeField: string;
  description: string;
  aiAssistPrompt: string;
  sortOrder: number;
}

export const DEFAULT_GTM_VARIABLES: DefaultGtmVariable[] = [
  {
    id: "default-usp",
    name: "Unique Selling Proposition",
    mergeField: "USP",
    description: "A terse formulation of your product's unique value - what makes you different and valuable to your ideal customer.",
    aiAssistPrompt: `Help me define my Unique Selling Proposition (USP). Ask me questions about:
- What my product/service does
- Who my target customers are
- What problem I solve for them
- What makes my solution different from alternatives
- Why customers choose me over competitors

Guide me through creating a clear, concise USP statement that captures my unique value. Keep it focused and memorable.`,
    sortOrder: 0,
  },
  {
    id: "default-icp",
    name: "Ideal Customer Profile",
    mergeField: "ICP",
    description: "A detailed description of your ideal customer - company size, industry, personas, pain points, and what makes them a great fit.",
    aiAssistPrompt: `Help me define my Ideal Customer Profile (ICP). Ask me questions about:
- Company characteristics (size, industry, stage, geography)
- Key personas/titles I sell to
- The pain points and challenges they face
- What makes a customer "juicy" - high value and easy to sell/retain
- What complementary technologies or situations signal a good fit

Help me create a comprehensive ICP that I can use to focus my sales and marketing efforts.`,
    sortOrder: 1,
  },
  {
    id: "default-discovery",
    name: "Discovery Questions",
    mergeField: "DISCOVERY_QUESTIONS",
    description: "Your go-to discovery questions for sales calls - questions that uncover pain, urgency, and fit.",
    aiAssistPrompt: `Help me build my Discovery Questions framework. Ask me about:
- My product and the problems it solves
- My ideal customer profile
- The typical buying process and stakeholders
- Common objections I face

Then help me create a set of powerful discovery questions that:
- Uncover real pain and its business impact
- Establish urgency and timeline
- Identify decision makers and process
- Qualify fit and budget
- Reveal the "why now" trigger

Focus on open-ended questions that get prospects talking about their situation.`,
    sortOrder: 2,
  },
  {
    id: "default-precall",
    name: "Pre-Call Planning Process",
    mergeField: "PRECALL_PROTOCOL",
    description: "Your standard process for preparing before a customer call - research steps, questions to prepare, and goals to set.",
    aiAssistPrompt: `Help me create my Pre-Call Planning Process. Ask me about:
- The types of calls I typically have (discovery, demo, negotiation, etc.)
- What information I usually need before a call
- How much time I typically have to prepare
- What's worked well in my best calls

Then help me build a repeatable pre-call checklist that covers:
- Research on the company and contacts
- Understanding their current situation
- Preparing relevant questions and talking points
- Setting clear objectives for the call
- Anticipating objections or concerns

Keep it practical and achievable given real-world time constraints.`,
    sortOrder: 3,
  },
];

// Helper to find a default variable by ID
export function getDefaultGtmVariable(defaultVariableId: string): DefaultGtmVariable | undefined {
  return DEFAULT_GTM_VARIABLES.find(v => v.id === defaultVariableId);
}

// Get all merge fields as a map for quick lookup
export function getMergeFieldMap(variables: { mergeField: string; value: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of variables) {
    if (v.value) {
      map.set(v.mergeField, v.value);
    }
  }
  return map;
}

// Expand merge fields in a prompt string
// Returns { expanded: string, usedVariables: string[], missingVariables: string[] }
export function expandMergeFields(
  prompt: string,
  variables: { mergeField: string; value: string | null }[]
): {
  expanded: string;
  usedVariables: string[];
  missingVariables: string[];
} {
  const mergeFieldMap = getMergeFieldMap(variables);
  const usedVariables: string[] = [];
  const missingVariables: string[] = [];

  // Match {{VARIABLE_NAME}} pattern
  const expanded = prompt.replace(/\{\{([A-Z_]+)\}\}/g, (match, fieldName) => {
    const value = mergeFieldMap.get(fieldName);
    if (value) {
      usedVariables.push(fieldName);
      return value;
    } else {
      missingVariables.push(fieldName);
      return match; // Keep the original if not found
    }
  });

  return { expanded, usedVariables, missingVariables };
}

// Find all merge fields used in a prompt string
export function findMergeFields(prompt: string): string[] {
  const matches = prompt.match(/\{\{([A-Z_]+)\}\}/g) || [];
  return matches.map(m => m.replace(/[{}]/g, ''));
}
