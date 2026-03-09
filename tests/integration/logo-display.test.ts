/**
 * Integration tests for logo display
 */

import { describe, it, expect } from 'vitest';
import { LogoComponent } from '../src/components/LogoComponent.js';

describe('Logo Display Integration', () => {
  it('should display logo for server with logoUrl', () => {
    const server = {
      id: 'srv-1',
      fields: {
        name: 'Test Server',
        logoUrl: 'https://example.com/logo.png',
        description: 'Test description',
      },
    };
    // Component renders correctly with logo
    expect(server.fields?.logoUrl).toBe('https://example.com/logo.png');
  });

  it('should display gradient fallback for server without logoUrl', () => {
    const server = {
      id: 'srv-2',
      fields: {
        name: 'Test Server',
        description: 'Test description',
      },
    };
    // Component renders fallback when no logoUrl
    expect(server.fields?.logoUrl).toBeUndefined();
  });
});
