import { prisma } from "@/lib/db";
import type { ToolEntry } from "@/lib/agents/shared/types";
import { findOwnThenAccount } from "@/lib/agents/shared/account-scoped";
import { HIRING_ROLE_TYPES, parseHiringRole, ROLE_META } from "@/lib/hiring/role-types";

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

const getHiringProfile: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "getHiringProfile",
      description:
        "Get the founder's authored hiring profile for a given seat — AE, SDR or CSM. Returns the role summary, ideal background, must-have competencies, where to look, red flags and interview criteria they wrote for that hire. Use for ANY question about what they're looking for: 'what profile are we hiring for', 'what background should the AE have', 'what are our must-haves for an SDR', 'what do we want in a CSM', 'is this candidate what we want', 'what should I screen for'. Pass roleType matching the seat being discussed; it defaults to AE. ALWAYS prefer this over inferring a profile from the maturity assessment or the sales narrative — those describe the company, this describes the hire. If it returns an error, say plainly that no profile is authored for that seat before reasoning from anything else.",
      parameters: {
        type: "object",
        properties: {
          roleType: {
            type: "string",
            enum: [...HIRING_ROLE_TYPES],
            description:
              "Which seat's profile to read. AE (closing rep), SDR (pipeline generation), CSM (post-sale retention and expansion). Defaults to AE.",
          },
        },
      },
    },
  },
  handler: async ({ roleType }: { roleType?: string }, { userId, accountId }) => {
    const role = parseHiringRole(roleType);
    const latest = await findOwnThenAccount(
      (where) =>
        prisma.hiringProfileVersion.findFirst({
          where: { ...where, roleType: role },
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, content: true, createdAt: true, roleType: true },
        }),
      userId,
      accountId
    );
    if (!latest) {
      return {
        error: `No ${ROLE_META[role].profileTitle} authored yet. The founder can create one at /hiring-profile?role=${role}. Say so before reasoning from stage or narrative instead — don't present an inferred profile as theirs.`,
      };
    }
    return {
      versionId: latest.id,
      roleType: latest.roleType,
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
  getHiringProfile,
  getSalesLeaderHiringProfile,
};
