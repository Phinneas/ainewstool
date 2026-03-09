/**
 * Metadata serializer/parser for logo system
 */

import { LogoMetadata } from './logoResolver.js';

/**
 * Serialize LogoMetadata to JSON
 */
export function serializeMetadata(metadata: LogoMetadata): string {
  return JSON.stringify({
    url: metadata.url,
    source: metadata.source,
    cachedAt: metadata.cachedAt,
    expiresAt: metadata.expiresAt,
    attempts: metadata.attempts,
    lastAttempt: metadata.lastAttempt,
  });
}

/**
 * Parse JSON into LogoMetadata
 */
export function parseMetadata(json: string): LogoMetadata {
  try {
    const data = JSON.parse(json);

    // Validate required fields
    if (!data.url || !data.cachedAt) {
      throw new Error('Missing required fields: url and cachedAt');
    }

    return {
      url: data.url,
      source: data.source || null,
      cachedAt: data.cachedAt,
      expiresAt: data.expiresAt || new Date(Date.now() + 86400000).toISOString(), // Default 24h
      attempts: data.attempts || 1,
      lastAttempt: data.lastAttempt || data.cachedAt,
    };
  } catch (error) {
    throw new Error(`Failed to parse metadata: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
  }
}

/**
 * Round-trip test: serialize then parse should produce equivalent object
 */
export function roundTripTest(metadata: LogoMetadata): boolean {
  try {
    const serialized = serializeMetadata(metadata);
    const parsed = parseMetadata(serialized);
    return (
      parsed.url === metadata.url &&
      parsed.source === metadata.source &&
      parsed.cachedAt === metadata.cachedAt &&
      parsed.expiresAt === metadata.expiresAt &&
      parsed.attempts === metadata.attempts &&
      parsed.lastAttempt === metadata.lastAttempt
    );
  } catch {
    return false;
  }
}
