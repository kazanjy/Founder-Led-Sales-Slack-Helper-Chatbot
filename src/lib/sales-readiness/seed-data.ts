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
  // ── WILL_SOMEONE_PAY — MVP Inbound ────────────────────
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Inbound Basics & Audit Inbound", order: 0 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request Button Well Placed", order: 1 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request Calendar Automation", order: 2 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request Internal Notifications & Response", order: 3 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request form qualification criteria & routing", order: 4 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request Prospect Facing auto-email", order: 5 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "MVP Inbound", title: "Demo Request Outbound Multi-thread", order: 6 },

  // ── WILL_SOMEONE_PAY — Inbound Process ────────────────
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Inbound Process", title: "Meeting Invite Format", order: 0 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Inbound Process", title: "Website De-anonymize & alert & action", order: 1 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Inbound Process", title: "Website De-anonymize automated action", order: 2 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Inbound Process", title: "Recorded Demo Video Collateral", order: 3 },

  // ── WILL_SOMEONE_PAY — MVP Inbound (User Table) ──────
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Signup Internal Alerting", order: 0 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Automatic Email", order: 1 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Backlog Enrich & Triage", order: 2 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Backlog Outbound", order: 3 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Signup Auto-Email With Content", order: 4 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "User Table Inbound", title: "User Table Outbound Multi-thread", order: 5 },

  // ── WILL_SOMEONE_PAY — Sales First Call ───────────────
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Are you properly blocking calendar for prep and follow-up?", order: 0 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Call Execution Setup (Second monitor)", order: 1 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Headphones", order: 2 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Pre-Call Planning Checklist", order: 3 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Rapport & Agenda Set Approach", order: 4 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Elevator Pitch", order: 5 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Discovery Questions", order: 6 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "First Call Checklist", order: 7 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Sales Deck", order: 8 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Demo Outline / Script", order: 9 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Pricing", order: 10 },
  { maturityStage: "WILL_SOMEONE_PAY", capabilityCategory: "Sales First Call", title: "Next Steps / Sales Motion Map", order: 11 },
];
