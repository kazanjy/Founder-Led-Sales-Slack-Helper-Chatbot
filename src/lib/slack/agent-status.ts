import type { WebClient } from "@slack/web-api";

/**
 * A live "here's what I'm doing" message in a Slack thread.
 *
 * Some agent turns take 30+ seconds — a candidate assessment does a PDL
 * enrich plus two model passes — and silence for that long reads as a
 * broken bot. So we post ONE status message on the first tool call and
 * chat.update it as work proceeds, rather than spraying a message per
 * tool. On completion it settles into a compact past-tense record of
 * what actually ran, which is worth keeping in the thread.
 *
 * Everything here is best-effort: a status post is a nicety, and a
 * failure to render one must never take down the actual answer.
 */

/**
 * Human phrasing per tool. Tools NOT listed here stay silent — a
 * playbook lookup returns fast and narrating it is just noise. Only
 * work slow or consequential enough that the founder would wonder
 * what's happening earns a line.
 */
const TOOL_NARRATION: Record<string, string> = {
  // Hiring — by far the slowest, and the one that prompted this.
  assessCandidateProfile: "Assessing the candidate — rebuilding their timeline and grading it",
  // Whole-account sweeps.
  getFullAccountContext: "Pulling your full GTM context together",
  getMaturityAssessment: "Reading your GTM maturity assessment",
  // Corpus searches.
  searchFounderLedSalesPlaybook: "Searching the founder-led sales playbook",
  searchCollateral: "Searching your collateral library",
  // Pipeline reads.
  listPipeline: "Reading your pipeline",
  getPipelineSummary: "Summarizing your pipeline",
  getDealsLikelyToClose: "Looking at what's likely to close",
  getDealsNeedingHelp: "Looking for deals that need attention",
  getUpcomingDealActivity: "Checking upcoming deal activity",
  getCoachingState: "Checking where your coaching is at",

  // Deal agent — the generative ones especially, they're slow.
  summarizeCall: "Summarizing the call",
  draftFollowUpEmail: "Drafting the follow-up",
  getHealthAndRisks: "Checking deal health and risks",
  getBusinessCaseArtifacts: "Pulling the business case artifacts",
  getRecentActivity: "Reading recent activity on the deal",
  getCallDetail: "Reading the call detail",
  addTimelineEntry: "Adding that to the deal timeline",

  // Coaching agent.
  summarizeCoachingSession: "Summarizing the coaching session",
  searchCoachingHistory: "Searching your coaching history",
  getFullCoachingHistory: "Reading your full coaching history",
  whereDidWeLeaveOff: "Looking up where we left off",
  addCoachingNote: "Saving that to your coaching notes",
  getLatestSalesMetrics: "Reading your latest metrics",
};

/** Past-tense phrasing for the settled summary. */
const TOOL_DONE: Record<string, string> = {
  assessCandidateProfile: "assessed the candidate",
  getFullAccountContext: "read your full GTM context",
  getMaturityAssessment: "read your maturity assessment",
  searchFounderLedSalesPlaybook: "searched the playbook",
  searchCollateral: "searched your collateral",
  listPipeline: "read your pipeline",
  getPipelineSummary: "summarized your pipeline",
  getDealsLikelyToClose: "checked what's likely to close",
  getDealsNeedingHelp: "checked deals needing attention",
  getUpcomingDealActivity: "checked upcoming activity",
  getCoachingState: "checked your coaching state",

  summarizeCall: "summarized the call",
  draftFollowUpEmail: "drafted the follow-up",
  getHealthAndRisks: "checked deal health and risks",
  getBusinessCaseArtifacts: "pulled the business case artifacts",
  getRecentActivity: "read recent deal activity",
  getCallDetail: "read the call detail",
  addTimelineEntry: "added it to the deal timeline",

  summarizeCoachingSession: "summarized the coaching session",
  searchCoachingHistory: "searched your coaching history",
  getFullCoachingHistory: "read your coaching history",
  whereDidWeLeaveOff: "looked up where we left off",
  addCoachingNote: "saved your coaching note",
  getLatestSalesMetrics: "read your latest metrics",
};

export function narrationFor(tool: string): string | null {
  return TOOL_NARRATION[tool] || null;
}

export class AgentStatus {
  private ts: string | undefined;
  private readonly ran: string[] = [];
  private posting: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: WebClient,
    private readonly channel: string,
    private readonly threadTs: string | undefined
  ) {}

  /**
   * Announce a tool that's about to run. Serialized behind the previous
   * post so a fast pair of tool calls can't race and lose the ts, which
   * would leave a stray status message orphaned in the thread.
   */
  announce(tool: string): void {
    const line = narrationFor(tool);
    if (!line) return;
    // Deduped: agents commonly call the same tool twice in a turn, and
    // "I read the call detail and read the call detail" is not a summary.
    const done = TOOL_DONE[tool];
    if (done && !this.ran.includes(done)) this.ran.push(done);
    this.posting = this.posting
      .then(() => this.render(`_${line}…_`))
      .catch((err) => console.error("[agent-status] announce failed:", err));
  }

  /**
   * Settle into a past-tense record once the answer is ready. Keeping it
   * (rather than deleting) means the thread shows what the agent
   * actually did, which is the point.
   */
  async settle(): Promise<void> {
    await this.posting.catch(() => {});
    if (!this.ts || this.ran.length === 0) return;
    const summary =
      this.ran.length === 1
        ? `_I ${this.ran[0]}._`
        : `_I ${this.ran.slice(0, -1).join(", ")} and ${this.ran[this.ran.length - 1]}._`;
    try {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text: summary });
    } catch (err) {
      console.error("[agent-status] settle failed:", err);
    }
  }

  /** Remove the status message entirely — used when nothing was posted. */
  async clear(): Promise<void> {
    await this.posting.catch(() => {});
    if (!this.ts) return;
    try {
      await this.client.chat.delete({ channel: this.channel, ts: this.ts });
      this.ts = undefined;
    } catch (err) {
      console.error("[agent-status] clear failed:", err);
    }
  }

  private async render(text: string): Promise<void> {
    if (this.ts) {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text });
      return;
    }
    const res = await this.client.chat.postMessage({
      channel: this.channel,
      text,
      thread_ts: this.threadTs,
      mrkdwn: true,
    });
    this.ts = res.ts;
  }
}
