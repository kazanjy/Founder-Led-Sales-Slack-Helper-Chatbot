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

  // Prisma's $extends generates per-model + per-operation arg types
  // that we can't easily satisfy from a generic factory. The trade-off
  // here is to type the destructured params as any inside the
  // interceptor and re-narrow the return value via the format(row)
  // signature — typesafe at the call site (each formatter has its own
  // typed Row), loose only inside the wrapper.
  const fireCreate = <T extends Row>(format: (row: T) => BroadcastEventInput) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: async ({ args, query }: any) => {
      const result = (await query(args)) as T;
      if (result?.userId && result?.id) {
        broadcastActivityFireAndForget(format(result));
      }
      return result;
    },
  });

  return base.$extends({
    query: {
      // New signups. Every provisioning path (Google OAuth, Slack
      // sign-in, Slack app install, Slack event auto-provision,
      // admin-created) runs prisma.user.create, so this one
      // interceptor covers them all. Custom (not fireCreate) because
      // a User row's own id IS the actor id — there's no userId FK.
      user: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async ({ args, query }: any) => {
          const result = await query(args);
          if (result?.id) {
            broadcastActivityFireAndForget({
              type: "signup",
              id: result.id,
              label: "🎉 New signup",
              title: result.email || result.slackEmail || null,
              link: "/admin/users",
              userId: result.id,
            });
          }
          return result;
        },
      },
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async ({ args, query }: any) => {
          const result = (await query(args)) as {
            id: string;
            name: string | null;
            createdByAdminId: string;
          };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: async ({ args, query }: any) => {
          const result = (await query(args)) as {
            id: string;
            userId: string;
            title: string;
            sessionStatus: string;
          };

          // Prisma update inputs accept either bare values
          // (sessionStatus: "locked") or operator objects
          // (sessionStatus: { set: "locked" }) — handle both forms so
          // we don't miss either flavor coming from API routes.
          const dataStatus: unknown = args?.data?.sessionStatus;
          const lockingNow =
            typeof dataStatus === "string"
              ? dataStatus === "locked"
              : (dataStatus as { set?: string } | undefined)?.set === "locked";

          if (
            result?.id &&
            result?.userId &&
            lockingNow &&
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

      // Conversations (chats) broadcast once, when a meaningful title
      // first lands on the row. Reasoning: a brand-new conversation is
      // created with title=null and gets its title async-filled by
      // generateChatTitle() right after the first user message. That's
      // the moment the chat is identifiable enough to be worth a
      // broadcast — earlier and we'd post "started a chat" with no
      // useful info; later (renames, message-count bumps,
      // lastMessageAt updates) we'd over-post.
      conversation: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: async ({ args, query }: any) => {
          // Detect a title-set update without doing an extra fetch on
          // the dozens of unrelated update flows (lastMessageAt,
          // messageCount, archived, etc.).
          const dataTitle: unknown = args?.data?.title;
          const titleBeingSet =
            typeof dataTitle === "string"
              ? dataTitle
              : (dataTitle as { set?: string } | undefined)?.set;

          let priorTitle: string | null | undefined;
          if (titleBeingSet) {
            try {
              const prior = await base.conversation.findUnique({
                where: args.where,
                select: { title: true },
              });
              priorTitle = prior?.title;
            } catch {
              // Prior lookup failure shouldn't fail the actual update.
              // Worst case we miss a broadcast.
              priorTitle = undefined;
            }
          }

          const result = (await query(args)) as {
            id: string;
            userId: string;
            title: string | null;
            source: string;
          };

          // Only fire on the *first* meaningful title. Skips renames
          // (priorTitle was already set) and the placeholder fallback.
          if (
            titleBeingSet &&
            titleBeingSet !== "New Conversation" &&
            !priorTitle &&
            result?.id &&
            result?.userId
          ) {
            const isSlack = result.source === "SLACK";
            broadcastActivityFireAndForget({
              type: isSlack ? "chat-slack" : "chat-web",
              id: result.id,
              label: `Started ${isSlack ? "Slack" : "Web"} chat`,
              title: titleBeingSet,
              link: `/chat/${result.id}`,
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
