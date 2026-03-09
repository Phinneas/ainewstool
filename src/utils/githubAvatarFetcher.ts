/**
 * GitHub Avatar Fetcher for MCP servers
 * Fetches GitHub organization avatars for server logos
 */

import { LogoResult } from './logoResolver.js';

/**
 * GitHub API client with rate limit handling
 */
export class GitHubClient {
  private token?: string;
  private timeout: number;

  constructor(token?: string, timeout: number = 1000) {
    this.token = token;
    this.timeout = timeout;
  }

  /**
   * Fetch repository information from GitHub API
   */
  async fetchRepo(owner: string, repo: string): Promise<any> {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'BrainScriblr-Newsletter/1.0',
        ...(this.token ? { Authorization: `token ${this.token}` } : {}),
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === 403) {
      throw new Error('GitHub API rate limited');
    }

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    return await response.json();
  }
}

/**
 * GitHub Avatar Fetcher
 */
export class GitHubAvatarFetcher {
  private client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  /**
   * Fetch avatar URL for a repository
   */
  async fetchAvatar(owner: string, repo: string): Promise<LogoResult> {
    try {
      const data = await this.client.fetchRepo(owner, repo);
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
   * Batch fetch avatars for multiple repositories
   */
  async batchFetchAvatars(
    repos: { owner: string; repo: string }[]
  ): Promise<Map<string, LogoResult>> {
    const results = new Map<string, LogoResult>();
    const promises = repos.map(async ({ owner, repo }) => {
      const result = await this.fetchAvatar(owner, repo);
      results.set(`${owner}/${repo}`, result);
    });
    await Promise.all(promises);
    return results;
  }
}
