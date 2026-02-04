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
  { id: "default-1", emoji: "🎯", title: "Can you help me tighten my ideal customer profile?", prompt: "Can you help me tighten my ideal customer profile?" },
  { id: "default-2", emoji: "🔍", title: "What would be good discovery questions for my product?", prompt: "What would be good discovery questions for my product?" },
  { id: "default-3", emoji: "📞", title: "Can you help me structure an effective first call?", prompt: "Can you help me structure an effective first call?" },
  { id: "default-4", emoji: "💎", title: "Can you help me define my product's value proposition?", prompt: "Can you help me construct a terse formulation of my product's unique selling proposition to our primary ideal customer profile. And then once we've done that, remind me to enter it in the appropriate GTM variable for use in saved prompts in this app." },
  // Column 2: Outreach & Execution
  { id: "default-5", emoji: "📧", title: "What would be good outbound messaging for my product?", prompt: "What would be good outbound messaging for my product?" },
  { id: "default-6", emoji: "📝", title: "Can you help me write an outbound sequence?", prompt: "Can you help me write an outbound sequence?" },
  { id: "default-7", emoji: "📚", title: "Can you help me put together my sales playbook?", prompt: "Can you help me put together my sales playbook?" },
  { id: "default-8", emoji: "💰", title: "Help me design a comp plan for a first sales rep.", prompt: "Help me design a comp plan for a first sales rep." },
  // Column 3: Team & Hiring
  { id: "default-9", emoji: "👤", title: "Can you help me define my ideal early AE hiring profile?", prompt: "Can you help me define my ideal early AE hiring profile?" },
  { id: "default-10", emoji: "📄", title: "Can you help me assess the resume of a potential AE hire?", prompt: "Can you help me assess the resume of a potential AE hire?" },
  { id: "default-11", emoji: "👥", title: "Can you give me guidance on a good sales rep hiring process?", prompt: "Can you give me guidance on a good sales rep hiring process?" },
  { id: "default-12", emoji: "🚀", title: "What would be an effective sales rep onboarding plan?", prompt: "What would be an effective sales rep onboarding plan?" },
  // Column 4: Education & Practice
  { id: "default-13", emoji: "🧠", title: "Take a quiz on your founder-led sales expertise.", prompt: "Can you give me a 20 question quiz about founder-led sales concepts, one question at a time? Test my expertise!" },
  { id: "default-14", emoji: "📖", title: "Give me a tutoring session on founder-led sales.", prompt: "Can you give me a short lesson on founder-led sales, and then quiz me on what we've covered? Give me some topic options to choose from first." },
  { id: "default-15", emoji: "🔤", title: "Can you quiz me on sales terminology?", prompt: "Can you quiz me on sales terminology? Give me questions one at a time and let me answer before moving to the next one. Cover common sales terms, acronyms, and concepts." },
  // Deal & Call Planning
  { id: "default-16", emoji: "🗓️", title: "Help me prepare for a call.", prompt: "Help me do precall planning for a customer call. Ask me about the customer I'm meeting, and some details about my product as a means by which to help me prepare. Remind me to edit the saved prompt if I want to add those details going forward." },
  { id: "default-17", emoji: "🤝", title: "Help me brainstorm a deal.", prompt: "I would like your help in discussing a deal and figuring out the best path forward for it, including highlighting potential risks." },
  { id: "default-18", emoji: "🎙️", title: "Help me review a sales call transcript.", prompt: "We're going to review the transcript of a sales call and provide feedback to the user. First, ask them what kind of call it is - examples being discovery, demo, proposal, negotiation, etc. Then ask them to paste the transcript in. Once done, give them an assessment of the call based on Pete's content on call execution." },
];

// Helper to find a default prompt by its original ID
export function getDefaultPrompt(defaultPromptId: string): DefaultPrompt | undefined {
  return DEFAULT_PROMPTS.find(p => p.id === defaultPromptId);
}
