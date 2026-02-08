/**
 * Subtitle Meanings Cache Service
 * Centralized management of meanings cache (Map<string, MeaningTh[]>)
 * 
 * Use this service when you need to store or retrieve cached meanings for tokens
 * Cache key format: `${subtitleId}_${tokenIndex}`
 */

import type { MeaningTh } from '@/schemas/meaningThSchema';

/**
 * Build cache key for a token's meanings
 * 
 * @param subtitleId - Subtitle ID
 * @param tokenIndex - Token index
 * @returns Cache key string
 */
export function buildMeaningsCacheKey(subtitleId: string, tokenIndex: number): string {
  return `${subtitleId}_${tokenIndex}`;
}

/**
 * Create a new meanings cache
 * 
 * @returns New empty Map for meanings cache
 */
export function createMeaningsCache(): Map<string, MeaningTh[]> {
  return new Map<string, MeaningTh[]>();
}

/**
 * Store meanings in cache for a token
 * 
 * @param cache - Meanings cache Map
 * @param subtitleId - Subtitle ID
 * @param tokenIndex - Token index
 * @param meanings - Array of meanings to store
 */
export function setMeaningsForToken(
  cache: Map<string, MeaningTh[]>,
  subtitleId: string,
  tokenIndex: number,
  meanings: MeaningTh[]
): void {
  const key = buildMeaningsCacheKey(subtitleId, tokenIndex);
  cache.set(key, meanings);
}

/**
 * Retrieve meanings from cache for a token
 * 
 * @param cache - Meanings cache Map
 * @param subtitleId - Subtitle ID
 * @param tokenIndex - Token index
 * @returns Array of meanings, or undefined if not cached
 */
export function getMeaningsForToken(
  cache: Map<string, MeaningTh[]>,
  subtitleId: string,
  tokenIndex: number
): MeaningTh[] | undefined {
  const key = buildMeaningsCacheKey(subtitleId, tokenIndex);
  return cache.get(key);
}
