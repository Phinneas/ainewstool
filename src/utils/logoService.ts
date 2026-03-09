/**
 * Logo Service with multi-source resolution
 * Implements the priority cascade: GitHub → Favicon → OG → Custom → Fallback
 */

import { LogoResult, LogoSource, resolveHomepageUrl } from './logoResolver.js';
import { CacheManager } from './cacheManager.js';
import { GitHubAvatarFetcher } from './githubAvatarFetcher.js';
import { FaviconFetcher } from './faviconFetcher.js';
import { OGImageFetcher } from './ogImageFetcher.js';
import { CustomLogoFetcher } from './customLogoFetcher.js';

/**
 * Logo Service
 */
export class LogoService {
  private cacheManager: CacheManager;
  private githubFetcher: GitHubAvatarFetcher;
  private faviconFetcher: FaviconFetcher;
  private ogImageFetcher: OGImageFetcher;
  private customLogoFetcher: CustomLogoFetcher;

  constructor(
    cacheManager: CacheManager,
    githubFetcher: GitHubAvatarFetcher,
    faviconFetcher: FaviconFetcher,
    ogImageFetcher: OGImageFetcher,
    customLogoFetcher: CustomLogoFetcher
  ) {
    this.cacheManager = cacheManager;
    this.githubFetcher = githubFetcher;
    this.faviconFetcher = faviconFetcher;
    this.ogImageFetcher = ogImageFetcher;
    this.customLogoFetcher = customLogoFetcher;
  }

  /**
   * Resolve logo for a server using multi-source strategy
   */
  async resolveLogo(server: {
    id?: string;
    fields?: {
      github_url?: string;
      homepage_url?: string;
      name?: string;
    };
  }): Promise<LogoResult> {
    const serverId = server.id || 'unknown';
    const githubUrl = server.fields?.github_url;

    // Check cache first
    const cachedLogo = await this.cacheManager.get(serverId);
    if (cachedLogo) {
      return {
        url: cachedLogo.url,
        source: cachedLogo.source,
        cachedAt: cachedLogo.cachedAt,
      };
    }

    // Parse GitHub URL to extract owner/repo
    const match = githubUrl?.match(/github\.com\/([^\/]+)\/([^\/]+)/);

    // PRIORITY 1: Custom repository logo
    if (match) {
      const [, owner, repo] = match;
      const customLogo = await this.customLogoFetcher.findCustomRepoLogo(
        owner,
        repo
      );
      if (customLogo) {
        const result = {
          url: customLogo,
          source: 'repo-custom' as LogoSource,
          cachedAt: new Date().toISOString(),
        };
        await this.cacheLogo(serverId, result);
        return result;
      }
    }

    // PRIORITY 2: Open Graph image
    const homepageUrl = await resolveHomepageUrl(server);
    if (homepageUrl) {
      const ogImage = await this.ogImageFetcher.extractOpenGraphImage(homepageUrl);
      if (ogImage) {
        const result = {
          url: ogImage,
          source: 'og-image' as LogoSource,
          cachedAt: new Date().toISOString(),
        };
        await this.cacheLogo(serverId, result);
        return result;
      }
    }

    // PRIORITY 3: GitHub organization avatar
    if (match) {
      const [, owner, repo] = match;
      const githubLogo = await this.githubFetcher.fetchAvatar(owner, repo);
      if (githubLogo.url) {
        await this.cacheLogo(serverId, githubLogo);
        return githubLogo;
      }
    }

    // PRIORITY 4: Favicon from homepage
    if (homepageUrl) {
      const faviconUrl = this.faviconFetcher.generateFaviconUrl(homepageUrl);
      if (faviconUrl) {
        const result = {
          url: faviconUrl,
          source: 'favicon' as LogoSource,
          cachedAt: new Date().toISOString(),
        };
        await this.cacheLogo(serverId, result);
        return result;
      }
    }

    // PRIORITY 5: Fallback (null = use gradient)
    const result = { url: null, source: null, cachedAt: null };
    await this.cacheLogo(serverId, result);
    return result;
  }

  /**
   * Cache logo result
   */
  private async cacheLogo(serverId: string, result: LogoResult): Promise<void> {
    if (!result.url) {
      // Cache negative results with short TTL
      const negativeCache: any = {
        url: null,
        source: null,
        cachedAt: result.cachedAt,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
        attempts: 1,
        lastAttempt: result.cachedAt || new Date().toISOString(),
      };
      await this.cacheManager.set(serverId, negativeCache);
      return;
    }

    const metadata: any = {
      url: result.url,
      source: result.source,
      cachedAt: result.cachedAt,
      expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours default
      attempts: 1,
      lastAttempt: result.cachedAt || new Date().toISOString(),
    };
    await this.cacheManager.set(serverId, metadata);
  }

  /**
   * Batch resolve logos for multiple servers
   */
  async batchResolveLogos(
    servers: {
      id?: string;
      fields?: {
        github_url?: string;
        homepage_url?: string;
        name?: string;
      };
    }[]
  ): Promise<Map<string, LogoResult>> {
    const results = new Map<string, LogoResult>();
    const promises = servers.map(async (server) => {
      const result = await this.resolveLogo(server);
      results.set(server.id || 'unknown', result);
    });
    await Promise.all(promises);
    return results;
  }
}
