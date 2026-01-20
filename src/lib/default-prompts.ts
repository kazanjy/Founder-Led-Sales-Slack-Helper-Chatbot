// Default prompts that ship with the app
// Shared between frontend and backend

export interface DefaultPrompt {
  id: string;
  emoji: string;
  title: string;
  prompt: string;
}

export const DEFAULT_PROMPTS: DefaultPrompt[] = [
  // Column 1: Foundation & Discovery
  { id: "default-1", emoji: "📏", title: "Can you help me measure my GTM maturity?", prompt: "Can you help me measure my GTM maturity?" },
  { id: "default-2", emoji: "🎯", title: "Can you help me tighten my ideal customer profile?", prompt: "Can you help me tighten my ideal customer profile?" },
  { id: "default-3", emoji: "🔍", title: "What would be good discovery questions for my product?", prompt: "What would be good discovery questions for my product?" },
  { id: "default-4", emoji: "📞", title: "Can you help me structure an effective first call?", prompt: "Can you help me structure an effective first call?" },
  // Column 2: Outreach & Execution
  { id: "default-5", emoji: "📧", title: "What would be good outbound messaging for my product?", prompt: "What would be good outbound messaging for my product?" },
  { id: "default-6", emoji: "📝", title: "Can you help me write an outbound sequence?", prompt: "Can you help me write an outbound sequence?" },
  { id: "default-7", emoji: "📚", title: "Can you help me put together my sales playbook?", prompt: "Can you help me put together my sales playbook?" },
  { id: "default-8", emoji: "💰", title: "Help me design a comp plan for a first sales rep.", prompt: "Help me design a comp plan for a first sales rep." },
  // Column 3: Team & Education
  { id: "default-9", emoji: "👥", title: "Can you give me guidance on a good sales rep hiring process?", prompt: "Can you give me guidance on a good sales rep hiring process?" },
  { id: "default-10", emoji: "🚀", title: "What would be an effective sales rep onboarding plan?", prompt: "What would be an effective sales rep onboarding plan?" },
  { id: "default-11", emoji: "🧠", title: "Take a quiz on your founder-led sales expertise.", prompt: "Can you give me a 20 question quiz about founder-led sales concepts, one question at a time? Test my expertise!" },
  { id: "default-12", emoji: "📖", title: "Give me a tutoring session on founder-led sales.", prompt: "Can you give me a short lesson on founder-led sales, and then quiz me on what we've covered? Give me some topic options to choose from first." },
  // Pre-call planning
  { id: "default-13", emoji: "🗓️", title: "Help me prepare for a call.", prompt: "Help me do precall planning for a customer call. Ask me about the customer I'm meeting, and some details about my product as a means by which to help me prepare. Remind me to edit the saved prompt if I want to add those details going forward." },
];

// Helper to find a default prompt by its original ID
export function getDefaultPrompt(defaultPromptId: string): DefaultPrompt | undefined {
  return DEFAULT_PROMPTS.find(p => p.id === defaultPromptId);
}
