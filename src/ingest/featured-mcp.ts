/**
 * Featured MCP fetcher for BrainScriblr newsletter.
 *
 * Calls the My MCP Shelf featured-mcps API, tracks previously featured
 * servers in S3 to avoid repeating the same MCP across issues.
 */

import { upload, download } from "../storage/s3.js";
import { log } from "../logger.js";

const FEATURED_MCPS_API = "https://www.mymcpshelf.com/api/featured-mcps";
const S3_HISTORY_KEY = "newsletter/featured-mcps-history.json";

export interface FeaturedMCP {
  id: string;
  name: string;
  description: string;
  stars: number;
  github_url: string | null;
  npm_package: string | null;
  author: string;
  shelf_url: string;
}

/**
 * Load the list of previously featured MCP IDs from S3.
 * Returns an empty array if the file doesn't exist yet.
 */
async function loadHistory(): Promise<string[]> {
  try {
    const raw = await download(S3_HISTORY_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // File doesn't exist yet — first run
    return [];
  }
}

/**
 * Save the updated history list back to S3.
 */
async function saveHistory(history: string[]): Promise<void> {
  await upload(S3_HISTORY_KEY, JSON.stringify(history, null, 2), "application/json");
}

/**
 * Fetch a featured MCP for this newsletter issue.
 *
 * - Loads history of previously featured MCPs from S3
 * - Passes them as ?exclude= to the featured-mcps API
 * - Saves the newly selected MCP ID back to S3
 * - Returns the selected FeaturedMCP object
 *
 * If the API is unavailable, returns null so the newsletter
 * can be assembled without a featured MCP rather than failing.
 */
export async function fetchFeaturedMCP(): Promise<FeaturedMCP | null> {
  log.info("Fetching featured MCP for newsletter");

  const history = await loadHistory();
  log.info(`Excluding ${history.length} previously featured MCPs`);

  const excludeParam = history.join(",");
  const apiUrl = excludeParam
    ? `${FEATURED_MCPS_API}?exclude=${encodeURIComponent(excludeParam)}&count=1`
    : `${FEATURED_MCPS_API}?count=1`;

  try {
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "BrainScriblr-Newsletter/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.error("featured-mcps API returned an error", { status: response.status });
      return null;
    }

    const data = (await response.json()) as { featured: FeaturedMCP[] };
    const picked = data.featured?.[0];

    if (!picked) {
      log.warn("featured-mcps API returned no results — history may be exhausted, resetting");
      // Reset history so we can cycle through again
      await saveHistory([]);
      return null;
    }

    // Record this pick so it won't be repeated
    const updatedHistory = [...history, picked.id];
    await saveHistory(updatedHistory);

    log.info("Featured MCP selected", { name: picked.name, stars: picked.stars });
    return picked;

  } catch (error) {
    log.error("Failed to fetch featured MCP", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Format a FeaturedMCP as a markdown newsletter section.
 */
export function formatFeaturedMCPSection(mcp: FeaturedMCP): string {
  const stars = mcp.stars > 0 ? ` ⭐ ${mcp.stars.toLocaleString()}` : "";
  const install = mcp.npm_package
    ? `\`\`\`\nnpx -y ${mcp.npm_package}\n\`\`\``
    : "";
  const installLine = install ? `\n\n**Quick install:**\n${install}` : "";
  const githubLine = mcp.github_url
    ? `\n\n[View on GitHub](${mcp.github_url}) · [Full details](${mcp.shelf_url})`
    : `\n\n[Full details](${mcp.shelf_url})`;

  return `## 🔌 Featured MCP: ${mcp.name}${stars}

*By ${mcp.author}*

${mcp.description}${installLine}${githubLine}`;
}
