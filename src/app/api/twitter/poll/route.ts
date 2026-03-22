import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPublicAnswer } from "@/lib/public-answers/generate";
import {
  pollMentions,
  getThreadContext,
  postReply,
  isTwitterConfigured,
  Tweet,
  TweetUser,
  TweetMedia,
} from "@/lib/public-answers/twitter";
import {
  moderateQuestion,
  extractQuestion,
} from "@/lib/public-answers/moderation";

// Vercel cron: allow up to 120s for processing multiple mentions
export const maxDuration = 120;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

/**
 * POST /api/twitter/poll
 *
 * Called by a cron job to poll Twitter for new @mentions,
 * generate answers, and reply with a preview + link.
 *
 * Protected by ADMIN_SECRET to prevent unauthorized triggering.
 */
export async function POST(req: Request) {
  // Auth check — cron jobs pass the admin secret
  const authHeader = req.headers.get("authorization");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTwitterConfigured()) {
    return NextResponse.json(
      { error: "Twitter API not configured" },
      { status: 503 }
    );
  }

  try {
    // Get the last poll state
    const settings = await prisma.globalSettings.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });

    const sinceId = settings.twitterSinceId;

    // Poll for new mentions
    const { tweets, users, media, newestId } = await pollMentions(sinceId);

    if (tweets.length === 0) {
      // Update poll timestamp even if no new mentions
      await prisma.globalSettings.update({
        where: { id: "global" },
        data: { twitterLastPollAt: new Date() },
      });

      return NextResponse.json({
        processed: 0,
        skipped: 0,
        message: "No new mentions",
      });
    }

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process each mention (oldest first for chronological order)
    const sortedTweets = [...tweets].reverse();

    for (const tweet of sortedTweets) {
      try {
        const result = await processMention(tweet, users, media);
        if (result.processed) {
          processed++;
        } else {
          skipped++;
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        errors.push(`Tweet ${tweet.id}: ${message}`);
        skipped++;
      }
    }

    // Update polling state with the newest tweet ID
    await prisma.globalSettings.update({
      where: { id: "global" },
      data: {
        twitterSinceId: newestId ?? sinceId,
        twitterLastPollAt: new Date(),
      },
    });

    return NextResponse.json({
      processed,
      skipped,
      total: tweets.length,
      newestId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[twitter/poll] Error:", err);
    return NextResponse.json(
      { error: "Poll failed", details: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}

// ---------- Per-mention processing ----------

async function processMention(
  tweet: Tweet,
  users: Map<string, TweetUser>,
  media: Map<string, TweetMedia>
): Promise<{ processed: boolean }> {
  const author = users.get(tweet.author_id);
  const handle = author?.username ?? "unknown";

  // Check if we already answered this tweet
  const existing = await prisma.publicAnswer.findUnique({
    where: { twitterTweetId: tweet.id },
    select: { id: true },
  });
  if (existing) {
    return { processed: false };
  }

  // Extract the question from the tweet text (strip @mentions)
  const question = extractQuestion(tweet.text, "AskMikey");
  if (!question) {
    return { processed: false };
  }

  // Run moderation
  const modResult = await moderateQuestion({
    text: question,
    authorHandle: handle,
  });

  if (!modResult.allowed) {
    // If it's a duplicate, reply with the existing answer link
    if (modResult.reason?.startsWith("duplicate:")) {
      const slug = modResult.reason.split(":")[1];
      const answerUrl = `${APP_URL}/answers/${slug}`;
      try {
        await postReply(
          tweet.id,
          "Great question! I've already answered this one:",
          answerUrl
        );
      } catch {
        // Reply failure is non-fatal
      }
    }
    return { processed: false };
  }

  // Gather thread context (walk reply chain)
  const { contextText, imageUrls } = await getThreadContext(tweet);

  // Collect image URLs from the mention tweet itself
  const mentionImageUrls: string[] = [];
  if (tweet.attachments?.media_keys) {
    for (const key of tweet.attachments.media_keys) {
      const m = media.get(key);
      if (m?.type === "photo" && m.url) {
        mentionImageUrls.push(m.url);
      }
    }
  }

  const allImageUrls = [...mentionImageUrls, ...imageUrls];

  // Build full context string
  let context = "";
  if (contextText) {
    context += `Thread context:\n${contextText}\n\n`;
  }
  if (allImageUrls.length > 0) {
    context += `Images attached to the conversation:\n${allImageUrls.join("\n")}\n\n`;
  }

  const tweetUrl = `https://twitter.com/${handle}/status/${tweet.id}`;

  // Generate the answer and store it
  const publicAnswer = await createPublicAnswer({
    question,
    context: context || undefined,
    source: "twitter",
    twitterTweetId: tweet.id,
    twitterTweetUrl: tweetUrl,
    twitterHandle: handle,
    twitterThreadContext: contextText || undefined,
  });

  // Reply to the tweet with preview + link
  const answerUrl = `${APP_URL}/answers/${publicAnswer.slug}`;
  try {
    await postReply(tweet.id, publicAnswer.preview, answerUrl);
  } catch (err) {
    // Log but don't fail the whole process — the answer is saved
    console.error(
      `[twitter/poll] Failed to reply to tweet ${tweet.id}:`,
      err
    );
  }

  return { processed: true };
}
