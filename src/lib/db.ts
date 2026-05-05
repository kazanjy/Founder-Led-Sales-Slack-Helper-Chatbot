import { PrismaClient } from "@prisma/client";
import { broadcastActivityFireAndForget, type BroadcastEventInput } from "@/lib/activity/broadcast";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof buildClient> | undefined;
};

/**
 * Build the Prisma client wrapped with a $extends interceptor that
 * fires a per-action Slack broadcast on every create of an
 * activity-producing model (and on the coaching session "lock" update —
 * the user-meaningful "complete" event for that surface).
 *
 * Adding a new capability to the activity feed is now a two-line
 * change: add an entry to fetchRecentActivity (for the digest +
 * dashboard) and add a formatter here (for per-action broadcast).
 */
function buildClient() {
  const base = new PrismaClient();

  type Row = { id: string; userId: string };

  const fireCreate = <T extends Row>(format: (row: T) => BroadcastEventInput) => ({
    async create({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
      const result = (await query(args)) as T;
      if (result?.userId && result?.id) {
        broadcastActivityFireAndForget(format(result));
      }
      return result;
    },
  });

  return base.$extends({
    query: {
      salesNarrativeVersion: fireCreate((r: Row & { title: string | null }) => ({
        type: "narrative", id: r.id, label: "Generated Narrative",
        title: r.title, link: `/sales-narrative?version=${r.id}`, userId: r.userId,
      })),
      discoveryQuestionsVersion: fireCreate((r: Row & { title: string | null }) => ({
        type: "discovery", id: r.id, label: "Generated Discovery Questions",
        title: r.title, link: `/discovery-questions?version=${r.id}`, userId: r.userId,
      })),
      firstCallChecklistVersion: fireCreate((r: Row & { title: string | null }) => ({
        type: "checklist", id: r.id, label: "Generated First Call Checklist",
        title: r.title, link: `/first-call-checklist?version=${r.id}`, userId: r.userId,
      })),
      preCallPlanningVersion: fireCreate((r: Row & { title: string | null }) => ({
        type: "precall-plan", id: r.id, label: "Generated Pre-Call Plan",
        title: r.title, link: `/pre-call-planning?version=${r.id}`, userId: r.userId,
      })),
      preCallResearch: fireCreate((r: Row & { companyName: string; contactName: string | null }) => ({
        type: "research", id: r.id, label: "Pre-Call Research",
        title: r.contactName ? `${r.companyName} — ${r.contactName}` : r.companyName,
        link: `/pre-call-planning/history?id=${r.id}`, userId: r.userId,
      })),
      emailSequenceVersion: fireCreate((r: Row) => ({
        type: "email-sequence", id: r.id, label: "Generated Email Sequence",
        title: null, link: `/email-sequence?version=${r.id}`, userId: r.userId,
      })),
      linkedInSequenceVersion: fireCreate((r: Row) => ({
        type: "linkedin-sequence", id: r.id, label: "Generated LinkedIn Sequence",
        title: null, link: `/linkedin-sequence?version=${r.id}`, userId: r.userId,
      })),
      coldCallScriptVersion: fireCreate((r: Row) => ({
        type: "cold-call", id: r.id, label: "Generated Call Script",
        title: null, link: `/call-scripts?version=${r.id}`, userId: r.userId,
      })),
      salesDeckVersion: fireCreate((r: Row) => ({
        type: "sales-deck", id: r.id, label: "Generated Sales Deck",
        title: null, link: `/sales-deck?version=${r.id}`, userId: r.userId,
      })),
      callReviewVersion: fireCreate(
        (r: Row & { title: string | null; overallScore: number | null; maxScore: number | null }) => {
          const score = r.overallScore != null && r.maxScore != null ? ` (${r.overallScore}/${r.maxScore})` : "";
          return {
            type: "call-review", id: r.id, label: "Call Review" + score,
            title: r.title, link: `/call-review?version=${r.id}`, userId: r.userId,
          };
        }
      ),
      maturityAssessment: fireCreate((r: Row & { title: string | null }) => ({
        type: "maturity", id: r.id, label: "Completed GTM Assessment",
        title: r.title, link: `/maturity-history`, userId: r.userId,
      })),
      salesMetricsAssessment: fireCreate((r: Row & { title: string | null }) => ({
        type: "sales-metrics", id: r.id, label: "Completed Sales Metrics Analysis",
        title: r.title, link: `/sales-metrics/${r.id}`, userId: r.userId,
      })),
      adCreatorVersion: fireCreate((r: Row & { orgPersona: string; humanPersona: string }) => ({
        type: "ad-creator", id: r.id, label: "Generated Ad Concepts",
        title: `${r.orgPersona} → ${r.humanPersona}`,
        link: `/ad-creator?version=${r.id}`, userId: r.userId,
      })),
      socialContentVersion: fireCreate((r: Row & { title: string | null; platform: string }) => ({
        type: "social-content", id: r.id, label: "Generated Social Content",
        title:
          r.title ||
          (r.platform === "linkedin" ? "LinkedIn posts" : r.platform === "twitter" ? "Twitter posts" : "Social posts"),
        link: `/social-content?version=${r.id}`, userId: r.userId,
      })),
      icpVersion: fireCreate((r: Row & { title: string }) => ({
        type: "icp", id: r.id, label: "Generated ICP",
        title: r.title, link: `/icp?version=${r.id}`, userId: r.userId,
      })),
      hiringProfileVersion: fireCreate((r: Row & { title: string }) => ({
        type: "hiring-profile", id: r.id, label: "Generated Hiring Profile",
        title: r.title, link: `/hiring-profile?version=${r.id}`, userId: r.userId,
      })),
      salesLeaderProfileVersion: fireCreate((r: Row & { title: string }) => ({
        type: "sales-leader-profile", id: r.id, label: "Generated Sales Leader Profile",
        title: r.title, link: `/sales-leader-profile?version=${r.id}`, userId: r.userId,
      })),
      preHireAssessmentVersion: fireCreate((r: Row & { title: string }) => ({
        type: "pre-hire-assessment", id: r.id, label: "Generated Pre-Hire Assessment",
        title: r.title, link: `/pre-hire-assessment?version=${r.id}`, userId: r.userId,
      })),
      callRecapVersion: fireCreate((r: Row & { title: string }) => ({
        type: "call-recap", id: r.id, label: "Generated Call Recap",
        title: r.title, link: `/call-recap?version=${r.id}`, userId: r.userId,
      })),
      objectionBootstrap: fireCreate((r: Row) => ({
        type: "objections", id: r.id, label: "Bootstrapped Objection Library",
        title: null, link: `/objection-library`, userId: r.userId,
      })),
      deal: fireCreate((r: Row & { name: string; companyName: string }) => ({
        type: "deal", id: r.id, label: "Created Deal",
        title: r.name || r.companyName, link: `/deals?deal=${r.id}`, userId: r.userId,
      })),

      // BroadcastCampaign uses createdByAdminId, not userId.
      broadcastCampaign: {
        async create({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
          const result = (await query(args)) as { id: string; name: string | null; createdByAdminId: string };
          if (result?.id && result?.createdByAdminId) {
            broadcastActivityFireAndForget({
              type: "broadcast",
              id: result.id,
              label: "Sent Broadcast",
              title: result.name,
              link: `/admin/channels`,
              userId: result.createdByAdminId,
            });
          }
          return result;
        },
      },

      // Coaching sessions broadcast on lock (update with
      // sessionStatus="locked"), not on creation. New + in_progress are
      // still drafts the user is iterating on.
      coachingSession: {
        async update({
          args,
          query,
        }: {
          args: { data?: { sessionStatus?: string } };
          query: (args: unknown) => Promise<unknown>;
        }) {
          const result = (await query(args)) as {
            id: string;
            userId: string;
            title: string;
            sessionStatus: string;
          };
          if (
            result?.id &&
            result?.userId &&
            args?.data?.sessionStatus === "locked" &&
            result.sessionStatus === "locked"
          ) {
            broadcastActivityFireAndForget({
              type: "coaching-session",
              id: result.id,
              label: "Locked Coaching Session",
              title: result.title,
              link: `/coaching-history?session=${result.id}`,
              userId: result.userId,
            });
          }
          return result;
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
