/**
 * Monitoring System for logo system
 * Tracks metrics and alerts on issues
 */

/**
 * Logo system metrics
 */
export interface LogoMetrics {
  logoFetchSuccessRate: number;
  cacheHitRate: number;
  averageFetchLatency: number;
  logoDisplayRate: number;
  fallbackRate: number;
  githubApiErrorRate: number;
  faviconApiErrorRate: number;
}

/**
 * Monitoring System
 */
export class MonitoringSystem {
  private metrics: LogoMetrics;
  private alerts: string[] = [];
  private listeners: Set<(metrics: LogoMetrics) => void> = new Set();

  constructor() {
    this.metrics = {
      logoFetchSuccessRate: 0,
      cacheHitRate: 0,
      averageFetchLatency: 0,
      logoDisplayRate: 0,
      fallbackRate: 0,
      githubApiErrorRate: 0,
      faviconApiErrorRate: 0,
    };
  }

  /**
   * Track logo fetch success
   */
  trackFetchSuccess(): void {
    this.updateMetric('logoFetchSuccessRate', this.metrics.logoFetchSuccessRate + 1);
  }

  /**
   * Track logo fetch failure
   */
  trackFetchFailure(): void {
    this.updateMetric('logoFetchSuccessRate', this.metrics.logoFetchSuccessRate - 1);
  }

  /**
   * Track cache hit
   */
  trackCacheHit(): void {
    this.updateMetric('cacheHitRate', this.metrics.cacheHitRate + 1);
  }

  /**
   * Track cache miss
   */
  trackCacheMiss(): void {
    this.updateMetric('cacheHitRate', this.metrics.cacheHitRate - 1);
  }

  /**
   * Track fetch latency
   */
  trackFetchLatency(latency: number): void {
    const totalLatency = this.metrics.averageFetchLatency * 100 + latency;
    this.updateMetric('averageFetchLatency', totalLatency / 101);
  }

  /**
   * Track logo display
   */
  trackLogoDisplay(): void {
    this.updateMetric('logoDisplayRate', this.metrics.logoDisplayRate + 1);
  }

  /**
   * Track fallback display
   */
  trackFallbackDisplay(): void {
    this.updateMetric('fallbackRate', this.metrics.fallbackRate + 1);
  }

  /**
   * Track GitHub API error
   */
  trackGitHubApiError(): void {
    this.updateMetric('githubApiErrorRate', this.metrics.githubApiErrorRate + 1);
  }

  /**
   * Track favicon API error
   */
  trackFaviconApiError(): void {
    this.updateMetric('faviconApiErrorRate', this.metrics.faviconApiErrorRate + 1);
  }

  /**
   * Update metric
   */
  private updateMetric(key: keyof LogoMetrics, value: number): void {
    this.metrics[key as string] = value;
    this.notifyListeners();
  }

  /**
   * Subscribe to metrics updates
   */
  subscribe(callback: (metrics: LogoMetrics) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get current metrics
   */
  getMetrics(): LogoMetrics {
    return this.metrics;
  }

  /**
   * Check alert conditions
   */
  checkAlerts(): void {
    if (this.metrics.cacheHitRate < 80) {
      this.addAlert('Cache hit rate below 80%');
    }
    if (this.metrics.logoDisplayRate < 90) {
      this.addAlert('Logo display rate below 90%');
    }
    if (this.metrics.githubApiErrorRate > 1) {
      this.addAlert('GitHub API error rate above 1%');
    }
  }

  /**
   * Add alert
   */
  private addAlert(message: string): void {
    if (!this.alerts.includes(message)) {
      this.alerts.push(message);
      console.warn(`[Logo System Alert] ${message}`);
    }
  }

  /**
   * Get alerts
   */
  getAlerts(): string[] {
    return this.alerts;
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }
}
