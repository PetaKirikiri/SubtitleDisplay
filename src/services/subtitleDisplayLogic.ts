/**
 * Subtitle Display Logic Service
 * Handles all data processing logic for subtitle display modes
 * TSX components should only receive formatted strings - no logic here
 */

import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import type { WordTh } from '@/schemas/wordThSchema';
import { fetchWord } from './supabaseClient';
import type { TokenObject } from '@/types/token';
import { extractTokenStrings, getTokenText, normalizeTokens } from './tokenCodec';

export type DisplayMode = 'thai' | 'tokens' | 'phonetics';

// Cache for phonetics lookups to avoid repeated queries
const phoneticsCache = new Map<string, string>();

/**
 * Format tokens array for display
 * Accepts both TokenObject[] and string[] formats
 */
export function formatTokensDisplay(tokens: TokenObject[] | string[] | undefined): string {
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    return '';
  }
  const tokenStrings = tokens.map(token => getTokenText(token));
  return tokenStrings.join(' ');
}


/**
 * Get phonetics for tokens by looking up words_th table
 * Returns array of phonetic strings (phonetic_en or g2p, whichever available)
 * Falls back to token text if word not found
 * Accepts both TokenObject[] and string[] formats
 */
export async function getPhoneticsForTokens(tokens: TokenObject[] | string[]): Promise<string[]> {
  if (!tokens || tokens.length === 0) {
    return [];
  }
  
  // Extract token strings using codec (handles both formats)
  const tokenStrings = extractTokenStrings(tokens);
  
  // Batch all database queries using Promise.all for parallel execution
  // IMPORTANT: Promise.all preserves array order, so phonetics will match tokens order
  const wordPromises = tokenStrings.map((token, index) => {
    // Check cache first
    if (phoneticsCache.has(token)) {
      const cached = phoneticsCache.get(token)!;
      return Promise.resolve({ index, token, phonetic: cached });
    }
    
    // Fetch word from database (parallel)
    return fetchWord(token).then(word => {
      if (word) {
        const phonetic = word.phonetic_en || word.g2p || token;
        phoneticsCache.set(token, phonetic);
        return { index, token, phonetic };
      } else {
        phoneticsCache.set(token, token);
        return { index, token, phonetic: token };
      }
    });
  });
  
  // Wait for all queries to complete in parallel
  // Promise.all preserves order, so results array matches tokens array order exactly
  const results = await Promise.all(wordPromises);
  
  // Extract phonetics in order (Promise.all guarantees order preservation)
  // NO SORTING - results are already in correct order matching tokens array
  const phonetics = results.map(r => r.phonetic);
  
  return phonetics;
}

/**
 * Format subtitle for display based on mode
 * Returns formatted string ready to display
 */
export async function formatSubtitleForDisplay(
  subtitle: SubtitleTh | null,
  mode: DisplayMode
): Promise<string> {
  if (!subtitle) {
    return '';
  }
  
  switch (mode) {
    case 'thai': {
      return subtitle.thai || '';
    }
    
    case 'tokens': {
      const tokensTh = subtitle.tokens_th;
      if (tokensTh && typeof tokensTh === 'object' && 'tokens' in tokensTh) {
        const tokens = (tokensTh as any).tokens;
        if (Array.isArray(tokens)) {
          return formatTokensDisplay(tokens);
        }
      }
      return '';
    }
    
    case 'phonetics': {
      const tokensTh = subtitle.tokens_th;
      if (!tokensTh || typeof tokensTh !== 'object' || !('tokens' in tokensTh)) {
        return '';
      }
      
      const tokens = (tokensTh as any).tokens;
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return '';
      }
      
      const phonetics = await getPhoneticsForTokens(tokens);
      return phonetics.join(' ');
    }
    
    default:
      return subtitle.thai || '';
  }
}

/**
 * Check if subtitle has tokens available
 */
export function hasTokens(subtitle: SubtitleTh | null): boolean {
  if (!subtitle || !subtitle.tokens_th) {
    return false;
  }
  
  const tokensTh = subtitle.tokens_th;
  if (typeof tokensTh === 'object' && 'tokens' in tokensTh) {
    const tokens = (tokensTh as any).tokens;
    return Array.isArray(tokens) && tokens.length > 0;
  }
  
  return false;
}
