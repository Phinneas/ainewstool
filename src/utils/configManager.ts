/**
 * Configuration Manager for logo system
 * Supports runtime configuration updates
 */

import { LogoConfig, defaultLogoConfig } from './logoResolver.js';

/**
 * Configuration Manager class
 */
export class ConfigManager {
  private config: LogoConfig;
  private listeners: Set<(newConfig: LogoConfig) => void> = new Set();

  constructor(initialConfig: LogoConfig = defaultLogoConfig) {
    this.config = initialConfig;
  }

  /**
   * Get current configuration
   */
  getConfig(): LogoConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LogoConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    this.notifyListeners();
  }

  /**
   * Subscribe to configuration changes
   */
  subscribe(callback: (newConfig: LogoConfig) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners of configuration changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.config);
    }
  }

  /**
   * Load configuration from environment
   */
  static fromEnv(env: Record<string, string>): LogoConfig {
    return {
      sources: {
        github: env.LOGO_SOURCE_GITHUB !== 'false',
        favicon: env.LOGO_SOURCE_FAVICON !== 'false',
        ogImage: env.LOGO_SOURCE_OG_IMAGE !== 'false',
        customRepo: env.LOGO_SOURCE_CUSTOM_REPO !== 'false',
      },
      timeouts: {
        github: parseInt(env.LOGO_TIMEOUT_GITHUB || '1000', 10),
        favicon: parseInt(env.LOGO_TIMEOUT_FAVICON || '1000', 10),
        ogImage: parseInt(env.LOGO_TIMEOUT_OG_IMAGE || '1000', 10),
        customRepo: parseInt(env.LOGO_TIMEOUT_CUSTOM_REPO || '500', 10),
      },
      cacheTtl: {
        github: parseInt(env.LOGO_CACHE_TTL_GITHUB || '21600', 10),
        favicon: parseInt(env.LOGO_CACHE_TTL_FAVICON || '86400', 10),
        ogImage: parseInt(env.LOGO_CACHE_TTL_OG_IMAGE || '604800', 10),
        customRepo: parseInt(env.LOGO_CACHE_TTL_CUSTOM_REPO || '604800', 10),
      },
    };
  }
}
