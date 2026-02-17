import { config } from "../config.js";
const BLOCKED_DOMAINS = [
    "reddit.com",
    "youtube.com",
    "youtu.be",
    "x.com",
    "github.com",
    "i.redd.it",
    "v.redd.it",
];
let redditAccessToken = null;
let tokenExpiresAt = 0;
async function getRedditToken() {
    if (redditAccessToken && Date.now() < tokenExpiresAt) {
        return redditAccessToken;
    }
    if (!config.reddit.clientId || !config.reddit.clientSecret) {
        throw new Error("Reddit credentials not configured");
    }
    const tokenController = new AbortController();
    const tokenTimeout = setTimeout(() => tokenController.abort(), 15_000);
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString("base64")}`,
            "User-Agent": "salish-newsletter-bot/1.0",
        },
        body: "grant_type=client_credentials",
        signal: tokenController.signal,
    });
    clearTimeout(tokenTimeout);
    const data = (await response.json());
    redditAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return redditAccessToken;
}
export async function getRedditPost(subreddit, postId) {
    try {
        const token = await getRedditToken();
        const postController = new AbortController();
        const postTimeout = setTimeout(() => postController.abort(), 15_000);
        const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/api/info?id=t3_${postId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "salish-newsletter-bot/1.0",
            },
            signal: postController.signal,
        });
        clearTimeout(postTimeout);
        if (!response.ok)
            return null;
        const data = (await response.json());
        return data.data.children[0]?.data ?? null;
    }
    catch {
        return null;
    }
}
export function extractRedditPostId(redditUrl) {
    const match = redditUrl.match(/comments\/([^/]+)/);
    return match?.[1] ?? null;
}
export function isAllowedRedditLink(url) {
    if (!url || url.trim() === "")
        return false;
    return !BLOCKED_DOMAINS.some((domain) => url.toLowerCase().includes(domain));
}
export async function processRedditFeedItems(items, subreddit) {
    const results = [];
    for (const item of items) {
        const postId = extractRedditPostId(item.url);
        if (!postId)
            continue;
        const post = await getRedditPost(subreddit, postId);
        if (!post || post.error)
            continue;
        if (!isAllowedRedditLink(post.url_overridden_by_dest))
            continue;
        results.push({
            title: post.title,
            url: post.url_overridden_by_dest,
            created_utc: post.created_utc,
        });
    }
    return results;
}
