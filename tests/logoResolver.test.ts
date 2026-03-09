/**
 * Unit tests for logo resolver
 */

import { describe, it, expect } from 'vitest';
import {
  resolveServerLogo,
  generateFaviconUrl,
  resolveHomepageUrl,
  findCustomRepoLogo,
  extractOpenGraphImage,
} from '../src/utils/logoResolver.js';

describe('Logo Resolver', () => {
  it('should return null for missing GitHub URL', async () => {
    const server = {
      fields: {
        name: 'Test Server',
      },
    };
    const result = await resolveServerLogo(server);
    expect(result.url).toBeNull();
    expect(result.source).toBeNull();
  });

  it('should generate favicon URL from homepage', () => {
    const homepageUrl = 'https://example.com';
    const faviconUrl = generateFaviconUrl(homepageUrl);
    expect(faviconUrl).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=128');
  });

  it('should handle invalid homepage URL', () => {
    const faviconUrl = generateFaviconUrl('not-a-url');
    expect(faviconUrl).toBeNull();
  });

  it('should return null for missing homepage URL', async () => {
    const server = {
      fields: {
        github_url: 'https://github.com/test/repo',
      },
    };
    const homepageUrl = await resolveHomepageUrl(server);
    expect(homepageUrl).toBeNull();
  });
});
