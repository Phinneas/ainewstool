/**
 * Logo resolution utility for MCP servers
 * Phase 1: GitHub organization avatars
 */

const CACHE_TTL = 86400; // 24 hours in seconds

/**
 * Logo source types
 */
export type LogoSource = 'repo-custom' | 'og-image' | 'github' | 'favicon' | null;

/**
 * Logo resolution result
 */
export interface LogoResult {
  url: string | null;
  source: LogoSource;
  cachedAt: string | null;
}

/**
 * Server logo metadata
 */
export interface LogoMetadata {
  url: string;
  source: LogoSource;
  cachedAt: string;
  expiresAt: string;
  attempts: number;
  lastAttempt: string;
}

/**
 * Server configuration for logo system
 */
export interface LogoConfig {
  sources: {
    github: boolean;
    favicon: boolean;
    ogImage: boolean;
    customRepo: boolean;
  };
  timeouts: {
    github: number;
    favicon: number;
    ogImage: number;
    customRepo: number;
  };
  cacheTtl: {
    github: number;
    favicon: number;
    ogImage: number;
    customRepo: number;
  };
}

/**
 * Default logo configuration
 */
export const defaultLogoConfig: LogoConfig = {
  sources: {
    github: true,
    favicon: true,
    ogImage: true,
    customRepo: true,
  },
  timeouts: {
    github: 1000,
    favicon: 1000,
    ogImage: 1000,
    customRepo: 500,
  },
  cacheTtl: {
    github: 21600, // 6 hours (aligned with stats cache)
    favicon: 86400, // 24 hours
    ogImage: 604800, // 7 days
    customRepo: 604800, // 7 days
  },
};

/**
 * Fetch logo URL for a server
 * @param server - Server object with github_url
 * @param env - Cloudflare Workers environment
 * @returns Logo data {url, source, cachedAt}
 */
export async function resolveServerLogo(
  server: { fields?: { github_url?: string; homepage_url?: string; name?: string } },
  env?: { GITHUB_TOKEN?: string; KV?: KVNamespace }
): Promise<LogoResult> {
  const githubUrl = server.fields?.github_url;
  if (!githubUrl) {
    return { url: null, source: null, cachedAt: null };
  }

  // Parse GitHub URL to extract owner/repo
  const match = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return { url: null, source: null, cachedAt: null };
  }

  const [, owner, repo] = match;

  try {
    // Try GitHub avatar first
    const githubLogo = await fetchGitHubAvatar(owner, repo, env);
    if (githubLogo.url) {
      return githubLogo;
    }

    // Try favicon from homepage
    const homepageUrl = await resolveHomepageUrl(server);
    if (homepageUrl) {
      const faviconUrl = generateFaviconUrl(homepageUrl);
      if (faviconUrl) {
        return {
          url: faviconUrl,
          source: 'favicon',
          cachedAt: new Date().toISOString(),
        };
      }
    }

    // No logo found
    return { url: null, source: null, cachedAt: null };
  } catch (error) {
    console.error(`Failed to resolve logo for ${owner}/${repo}:`, error);
    return { url: null, source: null, cachedAt: null };
  }
}

/**
 * Batch resolve logos for multiple servers
 * @param servers - Array of server objects
 * @param env - Cloudflare Workers environment
 * @returns Map of server IDs to logo data
 */
export async function batchResolveLogos(
  servers: { id?: string; fields?: { github_url?: string; homepage_url?: string; name?: string } }[],
  env?: { GITHUB_TOKEN?: string; KV?: KVNamespace }
): Promise<Map<string, LogoResult>> {
  const logoPromises = servers.map(async (server) => {
    const logo = await resolveServerLogo(server, env);
    return [server.id || 'unknown', logo];
  });
  const results = await Promise.all(logoPromises);
  return new Map(results);
}

/**
 * Fetch GitHub avatar URL for a repository
 */
async function fetchGitHubAvatar(
  owner: string,
  repo: string,
  env?: { GITHUB_TOKEN?: string; KV?: KVNamespace }
): Promise<LogoResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'BrainScriblr-Newsletter/1.0',
        ...(env?.GITHUB_TOKEN ? { Authorization: `token ${env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(1000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    const avatarUrl = data.owner?.avatar_url;

    if (avatarUrl) {
      return {
        url: `${avatarUrl}&s=128`,
        source: 'github',
        cachedAt: new Date().toISOString(),
      };
    }

    return { url: null, source: null, cachedAt: null };
  } catch (error) {
    console.error(`Failed to fetch GitHub avatar for ${owner}/${repo}:`, error);
    return { url: null, source: null, cachedAt: null };
  }
}

/**
 * Extract homepage URL from various sources
 */
export async function resolveHomepageUrl(
  server: { fields?: { homepage_url?: string; github_url?: string } }
): Promise<string | null> {
  // 1. Check explicit homepage_url
  if (server.fields?.homepage_url) {
    return server.fields.homepage_url;
  }

  // 2. Fetch from GitHub API
  const githubUrl = server.fields?.github_url;
  if (githubUrl) {
    const match = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      const [, owner, repo] = match;
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { 'User-Agent': 'BrainScriblr-Newsletter/1.0' },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.homepage) {
            return data.homepage;
          }
        }
      } catch (error) {
        console.error('Failed to fetch homepage from GitHub:', error);
      }
    }
  }

  return null;
}

/**
 * Generate favicon URL from homepage
 */
export function generateFaviconUrl(homepageUrl: string): string | null {
  if (!homepageUrl) return null;
  try {
    const url = new URL(homepageUrl);
    const domain = url.hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  } catch (error) {
    console.error('Invalid homepage URL:', homepageUrl);
    return null;
  }
}

/**
 * Check for custom logo in GitHub repository
 */
export async function findCustomRepoLogo(
  owner: string,
  repo: string,
  env?: { GITHUB_TOKEN?: string }
): Promise<string | null> {
  const logoPaths = [
    'logo.svg',
    'logo.png',
    'public/logo.svg',
    'public/logo.png',
    'assets/logo.svg',
    'assets/logo.png',
  ];

  for (const path of logoPaths) {
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`,
        {
          method: 'HEAD',
          headers: {
            'User-Agent': 'BrainScriblr-Newsletter/1.0',
            ...(env?.GITHUB_TOKEN ? { Authorization: `token ${env.GITHUB_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(500),
        }
      );
      if (response.ok) {
        return `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  // Also try 'master' branch (legacy)
  for (const path of logoPaths.slice(0, 2)) {
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/master/${path}`,
        {
          method: 'HEAD',
          headers: {
            'User-Agent': 'BrainScriblr-Newsletter/1.0',
            ...(env?.GITHUB_TOKEN ? { Authorization: `token ${env.GITHUB_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(500),
        }
      );
      if (response.ok) {
        return `https://raw.githubusercontent.com/${owner}/${repo}/master/${path}`;
      }
    } catch (error) {
      // Continue
    }
  }

  return null;
}

/**
 * Extract Open Graph image from homepage
 */
export async function extractOpenGraphImage(homepageUrl: string): Promise<string | null> {
  if (!homepageUrl) return null;
  try {
    const response = await fetch(homepageUrl, {
      headers: { 'User-Agent': 'BrainScriblr-Newsletter/1.0' },
      signal: AbortSignal.timeout(1000),
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Parse OG image meta tag
    const ogImageMatch = html.match(
      /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
    );
    if (ogImageMatch && ogImageMatch[1]) {
      let imageUrl = ogImageMatch[1];
      if (imageUrl.startsWith('/')) {
        const baseUrl = new URL(homepageUrl);
        return `${baseUrl.origin}${imageUrl}`;
      }
      return imageUrl;
    }

    // Fallback: Twitter image
    const twitterImageMatch = html.match(
      /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i
    );
    if (twitterImageMatch && twitterImageMatch[1]) {
      let imageUrl = twitterImageMatch[1];
      if (imageUrl.startsWith('/')) {
        const baseUrl = new URL(homepageUrl);
        return `${baseUrl.origin}${imageUrl}`;
      }
      return imageUrl;
    }

    return null;
  } catch (error) {
    console.error('Failed to extract OG image:', error);
    return null;
  }
}
