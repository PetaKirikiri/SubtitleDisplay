/**
 * Token Type Definitions
 * Centralized types for token representation
 */

/**
 * TokenObject represents a token with optional meaning selection
 * - t: Thai word text (required)
 * - meaning_id: Selected meaning ID from meanings_th table (optional)
 */
export type TokenObject = {
  t: string;
  meaning_id?: bigint;
};

/**
 * TokensTh represents the tokens_th JSONB structure
 * Can be in old format (string[]) or new format (TokenObject[])
 */
export type TokensTh = {
  tokens: TokenObject[] | string[];
};
