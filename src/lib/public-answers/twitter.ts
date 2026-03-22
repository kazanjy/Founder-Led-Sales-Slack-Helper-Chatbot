/**
 * Twitter/X API v2 client wrapper for Public Mikey integration.
 *
 * Handles:
 * - Polling for mentions of the bot account
 * - Fetching thread context (walking reply chains)
 * - Posting reply tweets with answer previews + links
 */

const TWITTER_API_BASE = "https://api.twitter.com/2";

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN!;
const API_KEY = process.env.TWITTER_API_KEY!;
const API_SECRET = process.env.TWITTER_API_SECRET!;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN!;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET!;
const BOT_USER_ID = process.env.TWITTER_BOT_USER_ID!;

// ---------- Types ----------

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  created_at?: string;
  attachments?: {
    media_keys?: string[];
  };
}

export interface TweetUser {
  id: string;
  username: string;
  name: string;
}

export interface TweetMedia {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
}

export interface MentionsPollResult {
  tweets: Tweet[];
  users: Map<string, TweetUser>;
  media: Map<string, TweetMedia>;
  newestId?: string;
}

// ---------- OAuth 1.0a signing for write operations ----------

async function oauth1Sign(
  method: string,
  url: string,
  params: Record<string, string> = {}
): Promise<string> {
  // We use the crypto module for HMAC-SHA1
  const { createHmac, randomBytes } = await import("crypto");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  // Combine all params for the signature base string
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${encodeRFC3986(k)}=${encodeRFC3986(allParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeRFC3986(url),
    encodeRFC3986(paramString),
  ].join("&");

  const signingKey = `${encodeRFC3986(API_SECRET)}&${encodeRFC3986(ACCESS_TOKEN_SECRET)}`;
  const signature = createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// ---------- Read operations (Bearer token) ----------

async function twitterGet(
  path: string,
  params?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${TWITTER_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitter API GET ${path} failed (${res.status}): ${body}`);
  }

  return res;
}

// ---------- Write operations (OAuth 1.0a) ----------

async function twitterPost(
  path: string,
  body: Record<string, unknown>
): Promise<Response> {
  const url = `${TWITTER_API_BASE}${path}`;
  const authHeader = await oauth1Sign("POST", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Twitter API POST ${path} failed (${res.status}): ${text}`
    );
  }

  return res;
}

// ---------- Public API ----------

/**
 * Poll for new mentions since the given tweet ID.
 * Returns tweets, author info, and media metadata.
 */
export async function pollMentions(
  sinceId?: string | null
): Promise<MentionsPollResult> {
  const params: Record<string, string> = {
    "tweet.fields": "author_id,conversation_id,in_reply_to_user_id,created_at,attachments",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "id,username,name",
    "media.fields": "media_key,type,url,preview_image_url",
    max_results: "20",
  };

  if (sinceId) {
    params.since_id = sinceId;
  }

  const res = await twitterGet(`/users/${BOT_USER_ID}/mentions`, params);
  const json = await res.json();

  const tweets: Tweet[] = json.data ?? [];
  const users = new Map<string, TweetUser>();
  const media = new Map<string, TweetMedia>();

  if (json.includes?.users) {
    for (const u of json.includes.users) {
      users.set(u.id, u);
    }
  }

  if (json.includes?.media) {
    for (const m of json.includes.media) {
      media.set(m.media_key, m);
    }
  }

  const newestId = json.meta?.newest_id ?? undefined;

  return { tweets, users, media, newestId };
}

/**
 * Fetch a single tweet by ID (used for walking reply chains).
 */
export async function getTweet(tweetId: string): Promise<{
  tweet: Tweet;
  users: Map<string, TweetUser>;
  media: Map<string, TweetMedia>;
}> {
  const res = await twitterGet(`/tweets/${tweetId}`, {
    "tweet.fields": "author_id,conversation_id,in_reply_to_user_id,created_at,attachments,text",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "id,username,name",
    "media.fields": "media_key,type,url,preview_image_url",
  });
  const json = await res.json();

  const users = new Map<string, TweetUser>();
  const media = new Map<string, TweetMedia>();

  if (json.includes?.users) {
    for (const u of json.includes.users) {
      users.set(u.id, u);
    }
  }

  if (json.includes?.media) {
    for (const m of json.includes.media) {
      media.set(m.media_key, m);
    }
  }

  return { tweet: json.data, users, media };
}

/**
 * Walk up a reply chain to gather thread context.
 * Stops after maxDepth hops or when hitting a root tweet.
 * Returns tweets from oldest → newest (chronological).
 */
export async function getThreadContext(
  tweet: Tweet,
  maxDepth = 5
): Promise<{ contextText: string; imageUrls: string[] }> {
  const chain: string[] = [];
  const imageUrls: string[] = [];
  let currentTweet = tweet;
  let depth = 0;

  // Collect images from the initial mention itself
  if (currentTweet.attachments?.media_keys) {
    // Media will be resolved by the caller from the initial pollMentions result
    // We only walk the chain here for parent tweets
  }

  while (depth < maxDepth) {
    // The Twitter v2 conversation_id equals the root tweet's ID
    // in_reply_to_user_id tells us there's a parent — but we need
    // the referenced tweet. Use the conversation search approach.
    const parentId = await findParentTweetId(currentTweet);
    if (!parentId) break;

    try {
      const { tweet: parent, media } = await getTweet(parentId);
      chain.unshift(`@${parent.author_id}: ${parent.text}`);

      // Collect image URLs from parent tweets
      if (parent.attachments?.media_keys) {
        for (const key of parent.attachments.media_keys) {
          const m = media.get(key);
          if (m?.type === "photo" && m.url) {
            imageUrls.push(m.url);
          }
        }
      }

      currentTweet = parent;
      depth++;
    } catch {
      // Tweet may be deleted or protected
      break;
    }
  }

  return {
    contextText: chain.length > 0 ? chain.join("\n\n") : "",
    imageUrls,
  };
}

/**
 * Find the parent tweet ID from a reply tweet.
 * Uses the conversation search endpoint to walk back.
 */
async function findParentTweetId(tweet: Tweet): Promise<string | null> {
  if (!tweet.conversation_id || tweet.conversation_id === tweet.id) {
    return null; // This IS the root tweet
  }

  // Use the search endpoint to find tweets in this conversation
  // that were created before this tweet
  try {
    const res = await twitterGet(`/tweets/search/recent`, {
      query: `conversation_id:${tweet.conversation_id}`,
      "tweet.fields": "author_id,in_reply_to_user_id,conversation_id,created_at",
      max_results: "100",
      sort_order: "recency",
    });
    const json = await res.json();
    const tweets: Tweet[] = json.data ?? [];

    // Find the tweet that this one replied to by looking at conversation order
    // The tweet directly before ours in the thread is our parent
    // Since we don't have a direct "in_reply_to_status_id" in v2,
    // we approximate by finding the root if depth is shallow
    if (tweet.conversation_id !== tweet.id) {
      // Try fetching the conversation root as context
      return tweet.conversation_id;
    }
  } catch {
    // Search may fail for old tweets or protected accounts
  }

  return null;
}

/**
 * Post a reply tweet with the answer preview and link.
 */
export async function postReply(
  inReplyToId: string,
  preview: string,
  answerUrl: string
): Promise<string> {
  // Twitter reply text: preview (truncated to fit) + URL
  // URLs count as 23 chars in Twitter's t.co wrapping
  const maxPreviewLength = 280 - 23 - 4; // 4 for "\n\n" + some buffer
  let text = preview;
  if (text.length > maxPreviewLength) {
    text = text.substring(0, maxPreviewLength - 3) + "...";
  }
  text = `${text}\n\n${answerUrl}`;

  const res = await twitterPost("/tweets", {
    text,
    reply: { in_reply_to_tweet_id: inReplyToId },
  });

  const json = await res.json();
  return json.data.id;
}

/**
 * Check if required Twitter env vars are configured.
 */
export function isTwitterConfigured(): boolean {
  return !!(
    process.env.TWITTER_BEARER_TOKEN &&
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_TOKEN_SECRET &&
    process.env.TWITTER_BOT_USER_ID
  );
}

export { BOT_USER_ID };
