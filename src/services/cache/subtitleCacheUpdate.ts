/**
 * Subtitle Cache Update Service
 * Helper for updating subtitle tokens in arrays/cache
 * 
 * Pure functions for immutable updates to subtitle arrays
 * Use this service when you need to update a token's meaning_id in a subtitle array
 */

import type { SubtitleTh, TokenObject } from '@/schemas/subtitleThSchema';

/**
 * Update a token's meaning_id in a subtitle array
 * Returns a new array with the updated subtitle (immutable update)
 * 
 * @param subtitles - Array of subtitles
 * @param subtitleId - ID of subtitle to update
 * @param tokenIndex - Index of token to update
 * @param meaningId - Meaning ID to assign to the token
 * @returns New array with updated subtitle, or original array if subtitle not found
 */
export function updateSubtitleTokenInArray(
  subtitles: SubtitleTh[],
  subtitleId: string,
  tokenIndex: number,
  meaningId: bigint
): SubtitleTh[] {
  const subtitleIndex = subtitles.findIndex(sub => sub.id === subtitleId);
  
  if (subtitleIndex === -1) {
    // Subtitle not found, return original array
    return subtitles;
  }
  
  const subtitle = subtitles[subtitleIndex];
  
  if (!subtitle.tokens_th?.tokens) {
    // No tokens to update, return original array
    return subtitles;
  }
  
  // Normalize tokens (convert string[] to TokenObject[] if needed) and update the token at the specified index
  const normalizedTokens: TokenObject[] = subtitle.tokens_th.tokens.map(t => typeof t === 'string' ? { t } : t);
  const updatedTokens = [...normalizedTokens]; // Create copy
  updatedTokens[tokenIndex] = {
    ...updatedTokens[tokenIndex],
    meaning_id: meaningId,
  };
  
  // Create updated subtitle
  const updatedSubtitle: SubtitleTh = {
    ...subtitle,
    tokens_th: {
      tokens: updatedTokens,
    },
  };
  
  // Create new array with updated subtitle
  const updatedSubtitles = [...subtitles];
  updatedSubtitles[subtitleIndex] = updatedSubtitle;
  
  return updatedSubtitles;
}
