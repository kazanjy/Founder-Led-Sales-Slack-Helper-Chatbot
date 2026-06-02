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
  // Auto-detected by the hourly call-recorder scanner — needs
  // user confirmation before counting as a pursued deal.
  { value: "potential", label: "Potential", color: "bg-purple-100 text-purple-700" },
  { value: "active", label: "Active", color: "bg-green-100 text-green-700" },
  { value: "stalled", label: "Stalled", color: "bg-amber-100 text-amber-700" },
  { value: "closed_won", label: "Closed Won", color: "bg-green-100 text-green-800 font-medium" },
  { value: "closed_lost", label: "Closed Lost", color: "bg-gray-100 text-gray-600" },
  // Archived because the user rejected an auto-detected potential.
  // Kept in DB (not hard-deleted) so the dedupe trail in
  // processed_recordings stays consistent.
  { value: "dismissed", label: "Dismissed", color: "bg-gray-100 text-gray-500" },
] as const;

export const CLOSED_LOST_REASONS = [
  { value: "unqualified", label: "Unqualified" },
  { value: "budget", label: "Budget" },
  { value: "timing", label: "Timing / Not a Priority" },
  { value: "competition", label: "Competition" },
  { value: "no_decision", label: "No Decision" },
  { value: "bad_fit", label: "Bad Fit" },
  { value: "status_quo", label: "Lost to Status Quo" },
  { value: "champion_left", label: "Champion Left" },
  { value: "other", label: "Other" },
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
  { value: "call_transcript", label: "Call Transcript", emoji: "📞", description: "Paste a full call transcript — Mikey extracts attendees, summary, and action items." },
  { value: "call_summary", label: "Call Summary", emoji: "📋", description: "A short recap of a call. Use when you don't have the full transcript." },
  { value: "email", label: "Email", emoji: "📧", description: "Paste an email thread or a single message you sent or received." },
  { value: "screenshot", label: "Screenshot", emoji: "📷", description: "Drop in a screenshot — Mikey reads the image and pulls out who and what." },
  { value: "note", label: "Note", emoji: "📝", description: "Free-form notes. Type, paste, or record a voice note that gets synthesized into a written summary." },
  { value: "linkedin", label: "LinkedIn", emoji: "💼", description: "A LinkedIn message, post, or comment relevant to this deal." },
  { value: "document", label: "Document", emoji: "📄", description: "Drop in a PDF or paste a doc — proposals, contracts, brief sheets." },
  { value: "chat", label: "Deal Chat", emoji: "🌊", description: "Saved breadcrumbs from chats with Mikey about this deal." },
  { value: "stage_change", label: "Stage Change", emoji: "🔀", description: "Automatic log entry written when a deal's pipeline stage changes." },
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
