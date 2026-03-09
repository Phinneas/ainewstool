/**
 * Custom Repository Logo Fetcher for MCP servers
 * Checks for custom logos in GitHub repositories
 */

import { LogoResult } from './logoResolver.js';

/**
 * Custom Repository Logo Fetcher
 */
export class CustomLogoFetcher {
  private timeout: number;

  constructor(timeout: number = 500) {
    this.timeout = timeout;
  }

  /**
   * Check for custom logo in GitHub repository
   */
  async findCustomRepoLogo(
    owner: string,
    repo: string,
    token?: string
  ): Promise<string | null> {
    const logoPaths = [
      'logo.svg',
      'logo.png',
      'public/logo.svg',
      'public/logo.png',
      'assets/logo.svg',
      'assets/logo.png',
    ];

    // Try 'main' branch first
    for (const path of logoPaths) {
      try {
        const response = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`,
          {
            method: 'HEAD',
            headers: {
              'User-Agent': 'BrainScriblr-Newsletter/1.0',
              ...(token ? { Authorization: `token ${token}` } : {}),
            },
            signal: AbortSignal.timeout(this.timeout),
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
              ...(token ? { Authorization: `token ${token}` } : {}),
            },
            signal: AbortSignal.timeout(this.timeout),
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
   * Fetch custom logo URL for a server
   */
  async fetchCustomLogo(server: {
    fields?: { github_url?: string };
  }): Promise<LogoResult> {
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
    const customLogoUrl = await this.findCustomRepoLogo(owner, repo);

    if (customLogoUrl) {
      return {
        url: customLogoUrl,
        source: 'repo-custom',
        cachedAt: new Date().toISOString(),
      };
    }

    return { url: null, source: null, cachedAt: null };
  }

  /**
   * Batch fetch custom logos for multiple servers
   */
  async batchFetchCustomLogos(
    servers: { fields?: { github_url?: string } }[]
  ): Promise<Map<string, LogoResult>> {
    const results = new Map<string, LogoResult>();
    const promises = servers.map(async (server) => {
      const result = await this.fetchCustomLogo(server);
      results.set(server.fields?.name || 'unknown', result);
    });
    await Promise.all(promises);
    return results;
  }
}
