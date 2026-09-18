// Default slots auto-created for each account on first visit to the Sales Asset Library.
// Order matters — this is the display order within each category.

export interface DefaultSlot {
  slotKey: string;
  name: string;
  category: "messaging" | "materials" | "process" | "onboarding" | "legal";
  description?: string;
}

export const DEFAULT_SLOTS: DefaultSlot[] = [
  // Messaging
  { slotKey: "salesNarrative", name: "Sales Narrative", category: "messaging", description: "Core positioning and messaging doc" },
  { slotKey: "objectionsAndFaqs", name: "Objections and FAQs", category: "messaging", description: "Common objections with handles and FAQ responses" },

  // Sales Materials
  { slotKey: "firstCallChecklistAndDiscovery", name: "First Call Checklist & Discovery Questions", category: "materials", description: "Checklist and question bank for first calls" },
  { slotKey: "salesDeck", name: "Sales Deck", category: "materials", description: "Main pitch deck" },
  { slotKey: "salesDeckScript", name: "Sales Deck Script", category: "materials", description: "Talk track and speaker notes for the deck" },
  { slotKey: "demoScript", name: "Demo Script", category: "materials", description: "Structured demo flow and talking points" },
  { slotKey: "demoVideo", name: "Demo Video", category: "materials", description: "Recorded demo or product walkthrough" },
  { slotKey: "pricing", name: "Pricing", category: "materials", description: "Pricing page, sheet, or calculator" },
  { slotKey: "businessCaseTemplate", name: "Business Case Template", category: "materials", description: "Template for building customer business cases" },
  { slotKey: "roiModel", name: "ROI Model", category: "materials", description: "ROI calculator or model template" },

  // Process
  { slotKey: "salesPlaybook", name: "Sales Playbook", category: "process", description: "End-to-end sales process documentation" },

  // Onboarding
  { slotKey: "onboardingChecklist", name: "Onboarding Checklist", category: "onboarding", description: "Steps for new customer onboarding" },
  { slotKey: "onboardingDeck", name: "Onboarding Deck", category: "onboarding", description: "Kickoff and onboarding presentation" },

  // Legal / Commercial
  { slotKey: "orderFormTemplate", name: "Order Form Template", category: "legal", description: "Standard order form or contract template" },
];

export const CATEGORY_LABELS: Record<string, string> = {
  messaging: "Messaging",
  materials: "Sales Materials",
  process: "Process",
  onboarding: "Customer Success / Onboarding",
  legal: "Legal / Commercial",
  custom: "Custom",
};

export const CATEGORY_ORDER = ["messaging", "materials", "process", "onboarding", "legal", "custom"];
