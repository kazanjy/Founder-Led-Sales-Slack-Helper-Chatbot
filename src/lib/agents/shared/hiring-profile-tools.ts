import { prisma } from "@/lib/db";
import type { ToolEntry } from "@/lib/agents/shared/types";
import { findOwnThenAccount } from "@/lib/agents/shared/account-scoped";

/**
 * Read the founder's authored hiring profiles.
 *
 * These were missing from every tool registry, which produced a
 * specific and bad failure: asked "what profiles are we looking for
 * for AE", Mikey reached for the GTM maturity assessment and
 * reconstructed a plausible answer from the bottlenecks listed there —
 * a reasonable-sounding profile that was NOT the one the founder had
 * actually written and shared with their team. Inventing an answer
 * that already exists in the product is worse than saying "I don't
 * know", because nobody can tell it happened.
 *
 * Lives in shared/ so both the GTM and coaching registries can list it
 * without a circular import. Account-scoped, since a hiring profile
 * belongs to the company rather than to whoever authored it.
 */

const getAEHiringProfile: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getAEHiringProfile",
      description:
        "Get the founder's authored AE Hiring Profile — the role summary, ideal background, must-have competencies, interview criteria and scorecard they wrote for the AE they're hiring. Use for ANY question about what they're looking for in a rep: 'what profile are we hiring for', 'what background should the AE have', 'what are our must-haves', 'should we hire an SDR or an AE', 'is this candidate what we want', 'what should I screen for'. ALWAYS prefer this over inferring a profile from the maturity assessment or the sales narrative — those describe the company, this describes the hire. If it returns an error, say plainly that no profile is authored yet before reasoning from anything else.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId, accountId }) => {
    const latest = await findOwnThenAccount(
      (where) =>
        prisma.hiringProfileVersion.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, content: true, createdAt: true },
        }),
      userId,
      accountId
    );
    if (!latest) {
      return {
        error:
          "No AE Hiring Profile authored yet. The founder can create one at /hiring-profile. Say so before reasoning from stage or narrative instead — don't present an inferred profile as theirs.",
      };
    }
    return {
      versionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

const getSalesLeaderHiringProfile: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getSalesLeaderHiringProfile",
      description:
        "Get the founder's authored Sales Leader Hiring Profile — what they want in a VP Sales / sales leader hire. Use for 'what are we looking for in a sales leader', 'when should we hire a VP of Sales and what should they look like', 'what should I screen a sales leader for'. Distinct from getAEHiringProfile, which covers the rep hire.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args: Record<string, never>, { userId, accountId }) => {
    const latest = await findOwnThenAccount(
      (where) =>
        prisma.salesLeaderProfileVersion.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, content: true, createdAt: true },
        }),
      userId,
      accountId
    );
    if (!latest) {
      return {
        error:
          "No Sales Leader Hiring Profile authored yet. The founder can create one at /sales-leader-profile.",
      };
    }
    return {
      versionId: latest.id,
      title: latest.title,
      createdAt: latest.createdAt.toISOString(),
      content: latest.content,
    };
  },
};

export const HIRING_PROFILE_TOOLS: Record<string, ToolEntry> = {
  getAEHiringProfile,
  getSalesLeaderHiringProfile,
};
