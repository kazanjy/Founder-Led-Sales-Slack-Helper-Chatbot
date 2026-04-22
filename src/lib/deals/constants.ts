export const DEAL_STAGES = [
  { value: "prospecting", label: "Prospecting", color: "bg-gray-100 text-gray-700" },
  { value: "discovery", label: "Discovery", color: "bg-blue-100 text-blue-700" },
  { value: "demo", label: "Demo", color: "bg-indigo-100 text-indigo-700" },
  { value: "proposal", label: "Proposal", color: "bg-purple-100 text-purple-700" },
  { value: "negotiation", label: "Negotiation", color: "bg-amber-100 text-amber-700" },
  { value: "closing", label: "Closing", color: "bg-orange-100 text-orange-700" },
  { value: "won", label: "Won", color: "bg-green-100 text-green-700" },
  { value: "lost", label: "Lost", color: "bg-red-100 text-red-700" },
] as const;

export const DEAL_STATUSES = [
  { value: "active", label: "Active", color: "bg-green-100 text-green-700" },
  { value: "stalled", label: "Stalled", color: "bg-amber-100 text-amber-700" },
  { value: "closed_won", label: "Closed Won", color: "bg-green-100 text-green-800 font-medium" },
  { value: "closed_lost", label: "Closed Lost", color: "bg-gray-100 text-gray-600" },
] as const;

export const PARTICIPANT_ROLES = [
  { value: "champion", label: "Champion", color: "bg-green-100 text-green-700" },
  { value: "decision_maker", label: "Decision Maker", color: "bg-blue-100 text-blue-700" },
  { value: "influencer", label: "Influencer", color: "bg-purple-100 text-purple-700" },
  { value: "blocker", label: "Blocker", color: "bg-red-100 text-red-700" },
  { value: "end_user", label: "End User", color: "bg-gray-100 text-gray-700" },
  { value: "unknown", label: "Unknown", color: "bg-gray-100 text-gray-500" },
] as const;

export const ENTRY_TYPES = [
  { value: "call_transcript", label: "Call Transcript", emoji: "📞" },
  { value: "call_summary", label: "Call Summary", emoji: "📋" },
  { value: "email", label: "Email", emoji: "📧" },
  { value: "screenshot", label: "Screenshot", emoji: "📷" },
  { value: "note", label: "Note", emoji: "📝" },
  { value: "linkedin", label: "LinkedIn", emoji: "💼" },
  { value: "document", label: "Document", emoji: "📄" },
  { value: "chat", label: "Deal Chat", emoji: "🌊" },
] as const;

export function getStageInfo(stage: string) {
  return DEAL_STAGES.find((s) => s.value === stage) || DEAL_STAGES[0];
}

export function getStatusInfo(status: string) {
  return DEAL_STATUSES.find((s) => s.value === status) || DEAL_STATUSES[0];
}

export function getRoleInfo(role: string) {
  return PARTICIPANT_ROLES.find((r) => r.value === role) || PARTICIPANT_ROLES[5];
}

export function getEntryTypeInfo(type: string) {
  return ENTRY_TYPES.find((t) => t.value === type) || { value: type, label: type, emoji: "📄" };
}
