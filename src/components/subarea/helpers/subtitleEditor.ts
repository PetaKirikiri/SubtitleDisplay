/**
 * Subtitle Editor Service
 * 
 * Domain logic for editing subtitles and tokens
 * Follows the same pattern as saveTokenMeaningSelection for consistency
 */

import { supabase } from '../../../supabase';
import { subtitleThSchema, type SubtitleTh } from '@/schemas/subtitleThSchema';
import { setSubtitleCache, getSubtitleCache } from '../../../services/cache/subtitleNavigation';

/**
 * Update subtitle Thai text
 * 
 * @param subtitleId - ID of subtitle to update
 * @param newThaiText - New Thai text for the subtitle
 * @returns Updated subtitle (verified from DB)
 */
export async function updateSubtitleThaiText(
  subtitleId: string,
  newThaiText: string
): Promise<SubtitleTh> {
  console.log(`[Editor] Updating subtitle ${subtitleId} Thai text`);
  
  if (!newThaiText.trim()) {
    throw new Error('Thai text cannot be empty');
  }
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    console.error(`[Editor] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Create updated subtitle
  const updatedSubtitle = {
    ...subtitle,
    thai: newThaiText.trim(),
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        thai: validated.thai,
      })
      .eq('id', subtitleId)
      .select();
    
    if (saveError) {
      console.error(`[Editor] ✗ Failed to save subtitle Thai text:`, saveError);
      throw new Error(`Failed to save subtitle Thai text: ${saveError.message}`);
    }
    
    // Verify save succeeded
    if (!saveData || saveData.length === 0) {
      throw new Error(`Failed to save subtitle Thai text: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData[0]);
  } catch (error) {
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  // Update cache
  const currentCache = getSubtitleCache();
  const cacheIndex = currentCache.findIndex(sub => sub.id === subtitleId);
  if (cacheIndex !== -1) {
    const updatedCache = [...currentCache];
    updatedCache[cacheIndex] = verifiedSubtitle;
    setSubtitleCache(updatedCache);
  }
  
  console.log(`[Editor] ✓ Successfully updated subtitle ${subtitleId} Thai text`);
  
  return verifiedSubtitle;
}

/**
 * Update token text
 * 
 * @param subtitleId - ID of subtitle containing the token
 * @param tokenIndex - Index of token to update
 * @param newTokenText - New text for the token
 * @returns Updated subtitle (verified from DB)
 */
export async function updateTokenText(
  subtitleId: string,
  tokenIndex: number,
  newTokenText: string
): Promise<SubtitleTh> {
  console.log(`[Editor] Updating subtitle ${subtitleId}, token index ${tokenIndex}`);
  
  if (!newTokenText.trim()) {
    throw new Error('Token text cannot be empty');
  }
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    console.error(`[Editor] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Ensure tokens_th exists and has tokens
  if (!subtitle.tokens_th || !subtitle.tokens_th.tokens) {
    throw new Error(`Subtitle ${subtitleId} has no tokens`);
  }
  
  const tokens = subtitle.tokens_th.tokens;
  
  // Validate token index
  if (tokenIndex < 0 || tokenIndex >= tokens.length) {
    throw new Error(`Token index ${tokenIndex} out of range (0-${tokens.length - 1})`);
  }
  
  // Normalize tokens to TokenObject[] format
  const normalizedTokens = tokens.map((token) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    return token;
  });
  
  // Update token at index
  const existingToken = normalizedTokens[tokenIndex];
  normalizedTokens[tokenIndex] = {
    ...existingToken,
    t: newTokenText.trim(),
    // Preserve meaning_id if it exists
    meaning_id: existingToken.meaning_id,
  };
  
  // Create updated subtitle with normalized tokens
  const updatedSubtitle = {
    ...subtitle,
    tokens_th: {
      tokens: normalizedTokens,
    },
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Convert BigInt values to numbers/strings for JSON serialization
  const serializableTokens = validated.tokens_th!.tokens.map((token) => {
    if (typeof token === 'string') {
      return token;
    }
    const tokenObj = token as { t: string; meaning_id?: bigint };
    if (tokenObj.meaning_id !== undefined && tokenObj.meaning_id !== null) {
      const meaningIdValue = tokenObj.meaning_id <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(tokenObj.meaning_id)
        : tokenObj.meaning_id.toString();
      return {
        t: tokenObj.t,
        meaning_id: meaningIdValue,
      };
    }
    return { t: tokenObj.t };
  });
  
  // Verify payload is serializable
  try {
    JSON.stringify(serializableTokens);
  } catch (serializeError) {
    const errorMsg = serializeError instanceof Error ? serializeError.message : String(serializeError);
    throw new Error(`Cannot serialize tokens payload: ${errorMsg}`);
  }
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', subtitleId)
      .select();
    
    if (saveError) {
      console.error(`[Editor] ✗ Failed to save token text:`, saveError);
      throw new Error(`Failed to save token text: ${saveError.message}`);
    }
    
    // Verify save succeeded
    if (!saveData || saveData.length === 0) {
      throw new Error(`Failed to save token text: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData[0]);
  } catch (error) {
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  // Update cache
  const currentCache = getSubtitleCache();
  const cacheIndex = currentCache.findIndex(sub => sub.id === subtitleId);
  if (cacheIndex !== -1) {
    const updatedCache = [...currentCache];
    updatedCache[cacheIndex] = verifiedSubtitle;
    setSubtitleCache(updatedCache);
  }
  
  console.log(`[Editor] ✓ Successfully updated subtitle ${subtitleId}, token index ${tokenIndex}`);
  
  return verifiedSubtitle;
}

/**
 * Update tokens array from space-separated string
 * 
 * This function handles token editing via the space-separated input editor.
 * When users edit the string (e.g., removing spaces to conjoin "word1 word2" → "word1word2"),
 * this function rebuilds the tokens array accordingly.
 * 
 * CRITICAL: This function ONLY updates the subtitle's tokens array in subtitles_th table.
 * It does NOT delete, remove, or modify words in words_th table.
 * 
 * When tokens are conjoined (spaces removed), the original words remain in words_th:
 * - "word1 word2" conjoined to "word1word2" → both "word1" and "word2" stay in words_th
 * - Only the subtitle's tokens array is updated to reflect the new structure
 * - Original words are preserved for historical reference and potential future use
 * 
 * @param subtitleId - ID of subtitle containing the tokens
 * @param tokensString - Space-separated string of tokens
 * @returns Updated subtitle (verified from DB)
 */
export async function updateTokensArray(
  subtitleId: string,
  tokensString: string
): Promise<SubtitleTh> {
  console.log(`[Editor] Updating subtitle ${subtitleId} tokens array`);
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    console.error(`[Editor] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Ensure tokens_th exists
  if (!subtitle.tokens_th || !subtitle.tokens_th.tokens) {
    throw new Error(`Subtitle ${subtitleId} has no tokens`);
  }
  
  const oldTokens = subtitle.tokens_th.tokens;
  
  // Split by spaces and filter out empty strings
  const newTokenTexts = tokensString.split(/\s+/).filter(t => t.length > 0);
  
  if (newTokenTexts.length === 0) {
    throw new Error('Tokens array cannot be empty');
  }
  
  // Normalize old tokens to TokenObject[] format
  const normalizedOldTokens = oldTokens.map((token) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    return token;
  });
  
  // Create new tokens array, trying to preserve meaning_id when token text matches
  // Use a map to track which old tokens have been used
  const usedOldTokens = new Set<number>();
  const newTokens: TokenObject[] = newTokenTexts.map((newText, index) => {
    // Try to find matching old token by text (prefer unused ones)
    const matchingOldIndex = normalizedOldTokens.findIndex(
      (oldToken, idx) => oldToken.t === newText && !usedOldTokens.has(idx)
    );
    
    if (matchingOldIndex !== -1) {
      // Found matching token - preserve meaning_id
      usedOldTokens.add(matchingOldIndex);
      return {
        t: newText,
        meaning_id: normalizedOldTokens[matchingOldIndex].meaning_id,
      };
    }
    
    // No match found - create new token without meaning_id
    return { t: newText };
  });
  
  // Create updated subtitle with new tokens
  const updatedSubtitle = {
    ...subtitle,
    tokens_th: {
      tokens: newTokens,
    },
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Convert BigInt values to numbers/strings for JSON serialization
  const serializableTokens = validated.tokens_th!.tokens.map((token) => {
    if (typeof token === 'string') {
      return token;
    }
    const tokenObj = token as { t: string; meaning_id?: bigint };
    if (tokenObj.meaning_id !== undefined && tokenObj.meaning_id !== null) {
      const meaningIdValue = tokenObj.meaning_id <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(tokenObj.meaning_id)
        : tokenObj.meaning_id.toString();
      return {
        t: tokenObj.t,
        meaning_id: meaningIdValue,
      };
    }
    return { t: tokenObj.t };
  });
  
  // Verify payload is serializable
  try {
    JSON.stringify(serializableTokens);
  } catch (serializeError) {
    const errorMsg = serializeError instanceof Error ? serializeError.message : String(serializeError);
    throw new Error(`Cannot serialize tokens payload: ${errorMsg}`);
  }
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', subtitleId)
      .select();
    
    if (saveError) {
      console.error(`[Editor] ✗ Failed to save tokens array:`, saveError);
      throw new Error(`Failed to save tokens array: ${saveError.message}`);
    }
    
    // Verify save succeeded
    if (!saveData || saveData.length === 0) {
      throw new Error(`Failed to save tokens array: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData[0]);
  } catch (error) {
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  // Update cache
  const currentCache = getSubtitleCache();
  const cacheIndex = currentCache.findIndex(sub => sub.id === subtitleId);
  if (cacheIndex !== -1) {
    const updatedCache = [...currentCache];
    updatedCache[cacheIndex] = verifiedSubtitle;
    setSubtitleCache(updatedCache);
  }
  
  console.log(`[Editor] ✓ Successfully updated subtitle ${subtitleId} tokens array`);
  
  return verifiedSubtitle;
}

/**
 * Split a token into two tokens
 * 
 * @param subtitleId - ID of subtitle containing the token
 * @param tokenIndex - Index of token to split
 * @param splitPosition - Character position to split at
 * @returns Updated subtitle (verified from DB)
 */
export async function splitToken(
  subtitleId: string,
  tokenIndex: number,
  splitPosition: number
): Promise<SubtitleTh> {
  console.log(`[Editor] Splitting subtitle ${subtitleId}, token index ${tokenIndex} at position ${splitPosition}`);
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    console.error(`[Editor] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Ensure tokens_th exists and has tokens
  if (!subtitle.tokens_th || !subtitle.tokens_th.tokens) {
    throw new Error(`Subtitle ${subtitleId} has no tokens`);
  }
  
  const tokens = subtitle.tokens_th.tokens;
  
  // Validate token index
  if (tokenIndex < 0 || tokenIndex >= tokens.length) {
    throw new Error(`Token index ${tokenIndex} out of range (0-${tokens.length - 1})`);
  }
  
  // Normalize tokens to TokenObject[] format
  const normalizedTokens = tokens.map((token) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    return token;
  });
  
  // Get token to split
  const tokenToSplit = normalizedTokens[tokenIndex];
  const tokenText = tokenToSplit.t;
  
  // Validate split position
  if (splitPosition < 0 || splitPosition > tokenText.length) {
    throw new Error(`Split position ${splitPosition} out of range (0-${tokenText.length})`);
  }
  
  if (splitPosition === 0 || splitPosition === tokenText.length) {
    throw new Error(`Split position must be between 0 and ${tokenText.length} (exclusive)`);
  }
  
  // Split token text
  const firstPart = tokenText.substring(0, splitPosition);
  const secondPart = tokenText.substring(splitPosition);
  
  // Create two new tokens (clear meaning_id on both)
  const firstToken = { t: firstPart };
  const secondToken = { t: secondPart };
  
  // Replace original token with two new tokens
  const updatedTokens = [
    ...normalizedTokens.slice(0, tokenIndex),
    firstToken,
    secondToken,
    ...normalizedTokens.slice(tokenIndex + 1),
  ];
  
  // Create updated subtitle
  const updatedSubtitle = {
    ...subtitle,
    tokens_th: {
      tokens: updatedTokens,
    },
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Convert BigInt values to numbers/strings for JSON serialization
  const serializableTokens = validated.tokens_th!.tokens.map((token) => {
    if (typeof token === 'string') {
      return token;
    }
    const tokenObj = token as { t: string; meaning_id?: bigint };
    if (tokenObj.meaning_id !== undefined && tokenObj.meaning_id !== null) {
      const meaningIdValue = tokenObj.meaning_id <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(tokenObj.meaning_id)
        : tokenObj.meaning_id.toString();
      return {
        t: tokenObj.t,
        meaning_id: meaningIdValue,
      };
    }
    return { t: tokenObj.t };
  });
  
  // Verify payload is serializable
  try {
    JSON.stringify(serializableTokens);
  } catch (serializeError) {
    const errorMsg = serializeError instanceof Error ? serializeError.message : String(serializeError);
    throw new Error(`Cannot serialize tokens payload: ${errorMsg}`);
  }
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', subtitleId)
      .select();
    
    if (saveError) {
      console.error(`[Editor] ✗ Failed to save split token:`, saveError);
      throw new Error(`Failed to save split token: ${saveError.message}`);
    }
    
    // Verify save succeeded
    if (!saveData || saveData.length === 0) {
      throw new Error(`Failed to save split token: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData[0]);
  } catch (error) {
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  // Update cache
  const currentCache = getSubtitleCache();
  const cacheIndex = currentCache.findIndex(sub => sub.id === subtitleId);
  if (cacheIndex !== -1) {
    const updatedCache = [...currentCache];
    updatedCache[cacheIndex] = verifiedSubtitle;
    setSubtitleCache(updatedCache);
  }
  
  console.log(`[Editor] ✓ Successfully split subtitle ${subtitleId}, token index ${tokenIndex}`);
  
  return verifiedSubtitle;
}

/**
 * Conjoin multiple tokens into a single token
 * 
 * NOTE: This function only updates the subtitle's tokens array in subtitles_th table.
 * It does NOT delete the original words from words_th table - they remain in the database
 * for historical reference and potential future use.
 * 
 * @param subtitleId - ID of subtitle containing the tokens
 * @param startTokenIndex - Start index of token range (inclusive)
 * @param endTokenIndex - End index of token range (inclusive)
 * @returns Updated subtitle (verified from DB)
 */
export async function conjoinTokens(
  subtitleId: string,
  startTokenIndex: number,
  endTokenIndex: number
): Promise<SubtitleTh> {
  console.log(`[Editor] Conjoining subtitle ${subtitleId}, tokens ${startTokenIndex} to ${endTokenIndex}`);
  
  // Validate range
  if (startTokenIndex > endTokenIndex) {
    throw new Error(`Start index ${startTokenIndex} must be <= end index ${endTokenIndex}`);
  }
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    console.error(`[Editor] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Ensure tokens_th exists and has tokens
  if (!subtitle.tokens_th || !subtitle.tokens_th.tokens) {
    throw new Error(`Subtitle ${subtitleId} has no tokens`);
  }
  
  const tokens = subtitle.tokens_th.tokens;
  
  // Validate token indices
  if (startTokenIndex < 0 || endTokenIndex >= tokens.length) {
    throw new Error(`Token range ${startTokenIndex}-${endTokenIndex} out of range (0-${tokens.length - 1})`);
  }
  
  // Normalize tokens to TokenObject[] format
  const normalizedTokens = tokens.map((token) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    return token;
  });
  
  // Get tokens in range
  const tokensToConjoin = normalizedTokens.slice(startTokenIndex, endTokenIndex + 1);
  
  // Concatenate token texts
  const concatenatedText = tokensToConjoin.map(token => token.t).join('');
  
  // Determine meaning_id
  // If all tokens have the same meaning_id, preserve it; otherwise clear it
  const meaningIds = tokensToConjoin
    .map(token => token.meaning_id)
    .filter((id): id is bigint => id !== undefined && id !== null);
  
  let determinedMeaningId: bigint | undefined;
  if (meaningIds.length === tokensToConjoin.length) {
    // All tokens have meaning_id - check if they're all the same
    const firstMeaningId = meaningIds[0];
    const allSame = meaningIds.every(id => id === firstMeaningId);
    if (allSame) {
      determinedMeaningId = firstMeaningId;
    }
    // Otherwise, determinedMeaningId remains undefined
  }
  // If not all tokens have meaning_id, determinedMeaningId remains undefined
  
  // Create single new token
  const conjoinedToken = {
    t: concatenatedText,
    ...(determinedMeaningId !== undefined && { meaning_id: determinedMeaningId }),
  };
  
  // Replace token range with single token
  const updatedTokens = [
    ...normalizedTokens.slice(0, startTokenIndex),
    conjoinedToken,
    ...normalizedTokens.slice(endTokenIndex + 1),
  ];
  
  // Create updated subtitle
  const updatedSubtitle = {
    ...subtitle,
    tokens_th: {
      tokens: updatedTokens,
    },
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Convert BigInt values to numbers/strings for JSON serialization
  const serializableTokens = validated.tokens_th!.tokens.map((token) => {
    if (typeof token === 'string') {
      return token;
    }
    const tokenObj = token as { t: string; meaning_id?: bigint };
    if (tokenObj.meaning_id !== undefined && tokenObj.meaning_id !== null) {
      const meaningIdValue = tokenObj.meaning_id <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(tokenObj.meaning_id)
        : tokenObj.meaning_id.toString();
      return {
        t: tokenObj.t,
        meaning_id: meaningIdValue,
      };
    }
    return { t: tokenObj.t };
  });
  
  // Verify payload is serializable
  try {
    JSON.stringify(serializableTokens);
  } catch (serializeError) {
    const errorMsg = serializeError instanceof Error ? serializeError.message : String(serializeError);
    throw new Error(`Cannot serialize tokens payload: ${errorMsg}`);
  }
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', subtitleId)
      .select();
    
    if (saveError) {
      console.error(`[Editor] ✗ Failed to save conjoined tokens:`, saveError);
      throw new Error(`Failed to save conjoined tokens: ${saveError.message}`);
    }
    
    // Verify save succeeded
    if (!saveData || saveData.length === 0) {
      throw new Error(`Failed to save conjoined tokens: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData[0]);
  } catch (error) {
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  // Update cache
  const currentCache = getSubtitleCache();
  const cacheIndex = currentCache.findIndex(sub => sub.id === subtitleId);
  if (cacheIndex !== -1) {
    const updatedCache = [...currentCache];
    updatedCache[cacheIndex] = verifiedSubtitle;
    setSubtitleCache(updatedCache);
  }
  
  console.log(`[Editor] ✓ Successfully conjoined subtitle ${subtitleId}, tokens ${startTokenIndex} to ${endTokenIndex}`);
  
  return verifiedSubtitle;
}

