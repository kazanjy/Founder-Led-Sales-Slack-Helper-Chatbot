// Sales Readiness Checklist — seed data
// Each item maps to a maturity stage, capability category, and specific asset/capability

export interface SeedItem {
  maturityStage: string;
  capabilityCategory: string;
  title: string;
  description?: string;
  order: number;
}

export const SALES_READINESS_SEED: SeedItem[] = [
  // ════════════════════════════════════════════════════════════
  // STAGE 1: PROBLEM_VALIDATION — "Do we know what problem we're solving?"
  // ════════════════════════════════════════════════════════════

  // ── Customer Research Call ──────────────────────────────────
  { maturityStage: "PROBLEM_VALIDATION", capabilityCategory: "Customer Research Call", title: "Customer Research Deck", order: 0 },

  // ── Customer Research Pipegen ──────────────────────────────
  { maturityStage: "PROBLEM_VALIDATION", capabilityCategory: "Customer Research Pipegen", title: "Hypothesized Customer Profile", order: 0 },
  { maturityStage: "PROBLEM_VALIDATION", capabilityCategory: "Customer Research Pipegen", title: "Hypothesized Customer Outbound (Email & LinkedIn)", order: 1 },

  // ── MVP Tech Stack ─────────────────────────────────────────
  { maturityStage: "PROBLEM_VALIDATION", capabilityCategory: "MVP Tech Stack", title: "Basic CRM", order: 0 },
  { maturityStage: "PROBLEM_VALIDATION", capabilityCategory: "MVP Tech Stack", title: "Call Recording Capability", order: 1 },

  // ════════════════════════════════════════════════════════════
  // STAGE 2: VALUE_VALIDATION — "Does the product solve the problem and create value?"
  // ════════════════════════════════════════════════════════════

  // ── Market Opportunity Hypothesis ──────────────────────────
  { maturityStage: "VALUE_VALIDATION", capabilityCategory: "Market Opportunity Hypothesis", title: "Sales Narrative (Product Marketing Messaging)", order: 0 },
  { maturityStage: "VALUE_VALIDATION", capabilityCategory: "Market Opportunity Hypothesis", title: "Ideal Customer Profile (Org, Humans) & Buckets", order: 1 },

  // ── Proof of Utility ───────────────────────────────────────
  { maturityStage: "VALUE_VALIDATION", capabilityCategory: "Proof of Utility", title: "Proof of Value: Quantitative & Qualitative", order: 0 },

  // ════════════════════════════════════════════════════════════
  // STAGE 3: FIRST_REVENUE — "Can we get someone to pay for the product?"
  // ════════════════════════════════════════════════════════════

  // ── Demand Generation Hypothesis ───────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Demand Generation Hypothesis", title: "LinkedIn Search URLs (Other URLs) for Targets", order: 0 },

  // ── MVP Outbound ───────────────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Outbound", title: "Outbound Email Sequence & LinkedIn Sequence", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Outbound", title: "Email Automation Capability", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Outbound", title: "LinkedIn Automation Capability", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Outbound", title: "Email Outbound Sequence", order: 3 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Outbound", title: "LinkedIn Outbound Sequence", order: 4 },

  // ── MVP Inbound ────────────────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Inbound Basics & Audit Inbound", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request Button Well Placed", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request Calendar Automation", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request Internal Notifications & Response", order: 3 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request form qualification criteria & routing", order: 4 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request Prospect Facing auto-email", order: 5 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Inbound", title: "Demo Request Outbound Multi-thread", order: 6 },

  // ── Inbound Process ────────────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Inbound Process", title: "Meeting Invite Format", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Inbound Process", title: "Website De-anonymize & alert & action", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Inbound Process", title: "Website De-anonymize automated action", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Inbound Process", title: "Recorded Demo Video Collateral", order: 3 },

  // ── User Table Inbound ─────────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Signup Internal Alerting", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Automatic Email", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Backlog Enrich & Triage", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Backlog Outbound", order: 3 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Signup Auto-Email With Content", order: 4 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "User Table Inbound", title: "User Table Outbound Multi-thread", order: 5 },

  // ── Sales First Call ───────────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Are you properly blocking calendar for prep and follow-up?", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Call Execution Setup (Second monitor)", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Headphones", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Pre-Call Planning Checklist", order: 3 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Rapport & Agenda Set Approach", order: 4 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Elevator Pitch", order: 5 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Discovery Questions", order: 6 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "First Call Checklist", order: 7 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Sales Deck", order: 8 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Demo Outline / Script", order: 9 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Pricing", order: 10 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Sales First Call", title: "Next Steps / Sales Motion Map", order: 11 },

  // ── Beginning Tech Stack ───────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "Beginning Tech Stack", title: "Order Form (Autorenew) / e-Sign / Payment Collection", order: 0 },

  // ── MVP Customer Success ───────────────────────────────────
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Customer Success", title: "Onboarding Checklist", order: 0 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Customer Success", title: "Onboarding Deck", order: 1 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Customer Success", title: "Inbound Support", order: 2 },
  { maturityStage: "FIRST_REVENUE", capabilityCategory: "MVP Customer Success", title: "Success Monitoring", order: 3 },

  // ════════════════════════════════════════════════════════════
  // STAGE 4: REPEATABLE_REVENUE — "Can we get many people to pay?"
  // ════════════════════════════════════════════════════════════

  // ── Intermediate Tech Stack ────────────────────────────────
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Tech Stack", title: "Real CRM", order: 0 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Tech Stack", title: "Metrics Basics", order: 1 },

  // ── Pipeline Management ────────────────────────────────────
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Pipeline Management", title: "Pipeline Review Cadence", order: 0 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Pipeline Management", title: "Business Case Template", order: 1 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Pipeline Management", title: "Closed Lost Opp Resurrection Process", order: 2 },

  // ── Intermediate Customer Success ──────────────────────────
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Customer Success", title: "Success Outcome Capture", order: 0 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Customer Success", title: "QBRs", order: 1 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Customer Success", title: "Renewal Motion", order: 2 },
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Intermediate Customer Success", title: "Implementation Deck / Checklist", order: 3 },

  // ── Sales Playbook Documentation ───────────────────────────
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Sales Playbook Documentation", title: "MVP Sales Playbook (ICP, Qualification, Stages, Metrics)", order: 0 },

  // ── Referral Prospecting ───────────────────────────────────
  { maturityStage: "REPEATABLE_REVENUE", capabilityCategory: "Referral Prospecting", title: "TK", order: 0 },
];
