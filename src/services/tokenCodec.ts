/**
 * Token Codec
 * Centralized encoding/decoding helpers for token representation
 * Enforces canonical token format across the codebase
 */

import type { TokenObject } from '@/types/token';

/**
 * Normalize tokens from old format (string[]) to new format (TokenObject[])
 * Handles both formats for backwards compatibility
 */
export function normalizeTokens(tokens: TokenObject[] | string[]): TokenObject[] {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  // Check if already in new format (first item is object with 't' property)
  if (tokens.length > 0 && typeof tokens[0] === 'object' && tokens[0] !== null && 't' in tokens[0]) {
    // Already normalized, validate and return
    return tokens.map(token => {
      const obj = token as TokenObject;
      return {
        t: obj.t,
        meaning_id: obj.meaning_id,
      };
    });
  }

  // Old format (string[]), convert to new format
  return tokens.map((token: string | TokenObject) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    // Already TokenObject but might need normalization
    return {
      t: token.t,
      meaning_id: token.meaning_id,
    };
  });
}

/**
 * Extract string array from TokenObject[] (for backwards compatibility)
 * Used by code that still expects string[]
 */
export function extractTokenStrings(tokens: TokenObject[] | string[]): string[] {
  const normalized = normalizeTokens(tokens);
  return normalized.map(token => token.t);
}

/**
 * Get text from TokenObject or string (handles both formats)
 * Utility for code that needs to work with either format
 */
export function getTokenText(token: TokenObject | string): string {
  if (typeof token === 'string') {
    return token;
  }
  return token.t;
}

/**
 * Check if token has meaning selection
 */
export function hasMeaningSelection(token: TokenObject | string): boolean {
  if (typeof token === 'string') {
    return false;
  }
  return token.meaning_id !== undefined && token.meaning_id !== null;
}

/**
 * Get meaning_id from token (returns undefined if not selected)
 */
export function getTokenMeaningId(token: TokenObject | string): bigint | undefined {
  if (typeof token === 'string') {
    return undefined;
  }
  return token.meaning_id;
}
