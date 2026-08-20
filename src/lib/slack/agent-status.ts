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
 * Human phrasing per tool, plus optional teaching copy.
 *
 * Tools NOT listed here stay silent — a playbook lookup returns fast and
 * narrating it is just noise. Only work slow or consequential enough
 * that the founder would wonder what's happening earns a line.
 *
 * `doing` and `done` live in one entry deliberately: as two parallel
 * maps keyed by tool name they drift, and a missing `done` silently
 * drops a tool from the summary.
 */
function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io").replace(/\/$/, "");
  return `${base}${path}`;
}

interface Narration {
  /** Present tense, shown while the tool runs. */
  doing: string;
  /** Past tense, folded into the settled summary. */
  done: string;
  /**
   * Shown under the working line. This is the teaching moment — the
   * founder is already waiting and reading, which is the one time
   * they'll actually absorb what else the tool accepts.
   */
  hint?: string;
  /** Shown under the settled summary, once the answer has landed. */
  followUp?: string;
}

const TOOL_NARRATION: Record<string, Narration> = {
  // Hiring — by far the slowest, and the one that prompted this.
  assessCandidateProfile: {
    // No inline emphasis here: the whole line gets wrapped in _…_ for
    // italics, and Slack renders nested *bold* inside that unreliably.
    doing: "Assessing the candidate — rebuilding their timeline and working out what each company was while they were there",
    done: "assessed the candidate",
    // Leads with the recommendation rather than the menu. The richer
    // inputs aren't a nicety — several green flags are UNREACHABLE from
    // a URL alone, because a profile lookup returns no education,
    // activities or awards at all. Say that, concretely, or founders
    // will keep pasting URLs and quietly get the thinner read.
    hint:
      "*For the best read, attach their résumé or a LinkedIn PDF export.*\n\n" +
      "A URL gets me employers, titles, dates and education — enough for the tenure, stage and schooling analysis. A full résumé adds what no profile lookup carries, and some of my strongest green flags can only fire when I can see it:\n" +
      "  • quota, attainment, President's Club, self-sourced %\n" +
      "  • athletics, including a professional or semi-pro career\n" +
      "  • military service, awards, scholarships, honors\n" +
      "  • whether they worked their way through school\n\n" +
      "Any of these work, and combining them is best:\n" +
      "  • a `linkedin.com/in/…` URL\n" +
      "  • a résumé — PDF or Word, just attach it to the thread\n" +
      "  • a LinkedIn profile export — their profile → *More* → *Save to PDF*\n" +
      "  • plain pasted text\n\n" +
      "Tip: tell me the seat — \"assess her for SDR\" — since the tenure bar differs by role.",
    // Deliberately NOT "attach a résumé" — the tool result already
    // nudges that, and only when they actually skipped one. Repeating
    // it here would say the same thing twice in one thread.
    followUp: `Every assessment is saved — you and your team can browse them at ${appUrl("/candidate-fit")}.`,
  },
  // Whole-account sweeps.
  getFullAccountContext: { doing: "Pulling your full GTM context together", done: "read your full GTM context" },
  getMaturityAssessment: { doing: "Reading your GTM maturity assessment", done: "read your maturity assessment" },
  getAEHiringProfile: { doing: "Reading your AE Hiring Profile", done: "read your AE Hiring Profile" },
  getSalesLeaderHiringProfile: {
    doing: "Reading your Sales Leader Hiring Profile",
    done: "read your Sales Leader Hiring Profile",
  },
  // Corpus searches.
  searchFounderLedSalesPlaybook: { doing: "Searching the founder-led sales playbook", done: "searched the playbook" },
  searchCollateral: { doing: "Searching your collateral library", done: "searched your collateral" },
  // Pipeline reads.
  listPipeline: { doing: "Reading your pipeline", done: "read your pipeline" },
  getPipelineSummary: { doing: "Summarizing your pipeline", done: "summarized your pipeline" },
  getDealsLikelyToClose: { doing: "Looking at what's likely to close", done: "checked what's likely to close" },
  getDealsNeedingHelp: { doing: "Looking for deals that need attention", done: "checked deals needing attention" },
  getUpcomingDealActivity: { doing: "Checking upcoming deal activity", done: "checked upcoming activity" },
  getCoachingState: { doing: "Checking where your coaching is at", done: "checked your coaching state" },

  // Deal agent — the generative ones especially, they're slow.
  summarizeCall: { doing: "Summarizing the call", done: "summarized the call" },
  draftFollowUpEmail: { doing: "Drafting the follow-up", done: "drafted the follow-up" },
  getHealthAndRisks: { doing: "Checking deal health and risks", done: "checked deal health and risks" },
  getBusinessCaseArtifacts: { doing: "Pulling the business case artifacts", done: "pulled the business case artifacts" },
  getRecentActivity: { doing: "Reading recent activity on the deal", done: "read recent deal activity" },
  getCallDetail: { doing: "Reading the call detail", done: "read the call detail" },
  addTimelineEntry: { doing: "Adding that to the deal timeline", done: "added it to the deal timeline" },

  // Coaching agent.
  summarizeCoachingSession: { doing: "Summarizing the coaching session", done: "summarized the coaching session" },
  searchCoachingHistory: { doing: "Searching your coaching history", done: "searched your coaching history" },
  getFullCoachingHistory: { doing: "Reading your full coaching history", done: "read your coaching history" },
  whereDidWeLeaveOff: { doing: "Looking up where we left off", done: "looked up where we left off" },
  addCoachingNote: { doing: "Saving that to your coaching notes", done: "saved your coaching note" },
  getLatestSalesMetrics: { doing: "Reading your latest metrics", done: "read your latest metrics" },
};

export function narrationFor(tool: string): Narration | null {
  return TOOL_NARRATION[tool] || null;
}

export class AgentStatus {
  private ts: string | undefined;
  private readonly ran: string[] = [];
  private readonly followUps: string[] = [];
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
    const n = narrationFor(tool);
    if (!n) return;
    // Deduped: agents commonly call the same tool twice in a turn, and
    // "I read the call detail and read the call detail" is not a summary.
    if (!this.ran.includes(n.done)) this.ran.push(n.done);
    if (n.followUp && !this.followUps.includes(n.followUp)) this.followUps.push(n.followUp);
    // The hint rides along with the working line, not as a second post:
    // the founder is already waiting and reading, and a separate message
    // would survive as clutter after the answer lands.
    const body = n.hint ? `_${n.doing}…_\n\n${n.hint}` : `_${n.doing}…_`;
    this.posting = this.posting
      .then(() => this.render(body))
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
    // The working hint is replaced here, so anything worth keeping has
    // to be restated as a follow-up — otherwise the teaching vanishes
    // the moment the answer arrives.
    const text = this.followUps.length
      ? `${summary}\n\n${this.followUps.join("\n\n")}`
      : summary;
    try {
      await this.client.chat.update({ channel: this.channel, ts: this.ts, text });
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
