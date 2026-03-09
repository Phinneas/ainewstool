/**
 * Logo System - Main entry point
 * Wires all components together
 */

import { CacheManager } from './cacheManager.js';
import { ConfigManager } from './configManager.js';
import { LogoService } from './logoService.js';
import { MonitoringSystem } from './monitoring.js';
import { GitHubAvatarFetcher } from './githubAvatarFetcher.js';
import { FaviconFetcher } from './faviconFetcher.js';
import { OGImageFetcher } from './ogImageFetcher.js';
import { CustomLogoFetcher } from './customLogoFetcher.js';
import { LogoComponent } from '../components/LogoComponent.js';

/**
 * Logo System
 */
export class LogoSystem {
  public cacheManager: CacheManager;
  public configManager: ConfigManager;
  public logoService: LogoService;
  public monitoring: MonitoringSystem;

  constructor(env: { GITHUB_TOKEN?: string; KV?: KVNamespace }) {
    // Initialize components
    this.configManager = new ConfigManager();
    this.cacheManager = new CacheManager(env.KV || ({} as KVNamespace));
    this.monitoring = new MonitoringSystem();

    // Initialize fetchers
    const githubClient = new GitHubClient(env.GITHUB_TOKEN);
    const githubFetcher = new GitHubAvatarFetcher(githubClient);
    const faviconFetcher = new FaviconFetcher();
    const ogImageFetcher = new OGImageFetcher();
    const customLogoFetcher = new CustomLogoFetcher();

    // Initialize logo service
    this.logoService = new LogoService(
      this.cacheManager,
      githubFetcher,
      faviconFetcher,
      ogImageFetcher,
      customLogoFetcher
    );
  }

  /**
   * Resolve logo for a server
   */
  async resolveLogo(server: {
    id?: string;
    fields?: {
      github_url?: string;
      homepage_url?: string;
      name?: string;
    };
  }) {
    return this.logoService.resolveLogo(server);
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
  ) {
    return this.logoService.batchResolveLogos(servers);
  }

  /**
   * Get monitoring metrics
   */
  getMetrics() {
    return this.monitoring.getMetrics();
  }

  /**
   * Check alerts
   */
  checkAlerts() {
    this.monitoring.checkAlerts();
  }
}

// Export components for individual use
export {
  CacheManager,
  ConfigManager,
  LogoService,
  MonitoringSystem,
  GitHubAvatarFetcher,
  FaviconFetcher,
  OGImageFetcher,
  CustomLogoFetcher,
  LogoComponent,
};
