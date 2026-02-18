/**
 * Subtitle Editor Service
 * 
 * Domain logic for editing subtitles and tokens
 * Follows the same pattern as saveTokenMeaningSelection for consistency
 */

import { supabase } from '../../../supabase';
import { subtitleThSchema, type SubtitleTh } from '@/schemas/subtitleThSchema';
import { updateSubtitlesCache } from '../../../lib/tanstackOperations';

function getMediaIdFromSubtitleId(subtitleId: string): string | null {
  const i = subtitleId.lastIndexOf('_');
  return i !== -1 ? subtitleId.substring(0, i) : null;
}

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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Updating subtitle Thai text',data:{subtitleId,newThaiTextLength:newThaiText.length},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the database, not the parameter
  // This ensures we preserve the exact format (mediaId_index) and don't accidentally create new entries
  const exactSubtitleId = subtitle.id;
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Using exact ID from database',data:{subtitleIdParam:subtitleId,exactIdFromDB:exactSubtitleId,idsMatch:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Attempting to update subtitle',data:{exactSubtitleId,thaiPreview:validated.thai.substring(0,50)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        thai: validated.thai,
      })
      .eq('id', exactSubtitleId) // Use exact ID from database
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Failed to save subtitle Thai text',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save subtitle Thai text: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save subtitle Thai text: No data returned from update`);
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Update successful',data:{subtitleId,id:saveData.id,thaiPreview:saveData.thai?.substring(0,50),thaiFullLength:saveData.thai?.length,thaiMatchesInput:saveData.thai === validated.thai},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Exception during save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(subtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === subtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleThaiText',message:'Successfully updated subtitle Thai text',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
  return verifiedSubtitle;
}

/**
 * Update subtitle timing (start_sec_th and/or end_sec_th)
 * 
 * @param subtitleId - ID of subtitle to update
 * @param startSecTh - New start time (optional)
 * @param endSecTh - New end time (optional)
 * @returns Updated subtitle (verified from DB)
 */
export async function updateSubtitleTiming(
  subtitleId: string,
  startSecTh?: number,
  endSecTh?: number
): Promise<SubtitleTh> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Updating subtitle timing',data:{subtitleId,startSecTh,endSecTh},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the fetched subtitle to ensure format matches (mediaId_index, not mediaId-index)
  const exactSubtitleId = subtitle.id;
  
  // Validate timing values
  if (startSecTh !== undefined && (isNaN(startSecTh) || startSecTh < 0)) {
    throw new Error('start_sec_th must be a non-negative number');
  }
  if (endSecTh !== undefined && (isNaN(endSecTh) || endSecTh < 0)) {
    throw new Error('end_sec_th must be a non-negative number');
  }
  if (startSecTh !== undefined && endSecTh !== undefined && endSecTh < startSecTh) {
    throw new Error('end_sec_th must be >= start_sec_th');
  }
  
  // Create updated subtitle
  const updatedSubtitle = {
    ...subtitle,
    ...(startSecTh !== undefined && { start_sec_th: startSecTh }),
    ...(endSecTh !== undefined && { end_sec_th: endSecTh }),
  };
  
  // Validate updated subtitle
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Prepare update data
  const updateData: any = {};
  if (startSecTh !== undefined) {
    updateData.start_sec_th = validated.start_sec_th;
  }
  if (endSecTh !== undefined) {
    updateData.end_sec_th = validated.end_sec_th;
  }
  
  // Save to database
  let verifiedSubtitle: SubtitleTh;
  try {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Attempting to update subtitle timing',data:{subtitleId,exactSubtitleId,updateData,idMatches:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update(updateData)
      .eq('id', exactSubtitleId) // Use exact ID from fetched subtitle to ensure format matches
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Failed to save subtitle timing',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save subtitle timing: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save subtitle timing: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Exception during timing save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(exactSubtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === exactSubtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateSubtitleTiming',message:'Successfully updated subtitle timing',data:{subtitleId,exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Updating token text',data:{subtitleId,tokenIndex,newTokenText},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the fetched subtitle to ensure format matches (mediaId_index, not mediaId-index)
  const exactSubtitleId = subtitle.id;
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Attempting to update token text',data:{subtitleId,exactSubtitleId,tokenIndex,tokenCount:serializableTokens.length,idMatches:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', exactSubtitleId) // Use exact ID from fetched subtitle to ensure format matches
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Failed to save token text',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save token text: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save token text: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Exception during token text save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(exactSubtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === exactSubtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokenText',message:'Successfully updated token text',data:{subtitleId,exactSubtitleId,tokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Updating tokens array',data:{subtitleId,tokensStringLength:tokensString.length},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the fetched subtitle to ensure format matches (mediaId_index, not mediaId-index)
  const exactSubtitleId = subtitle.id;
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Attempting to update tokens array',data:{subtitleId,exactSubtitleId,tokenCount:serializableTokens.length,idMatches:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', exactSubtitleId) // Use exact ID from fetched subtitle to ensure format matches
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Failed to save tokens array',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save tokens array: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save tokens array: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Exception during tokens array save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(exactSubtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === exactSubtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:updateTokensArray',message:'Successfully updated tokens array',data:{subtitleId,exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Splitting token',data:{subtitleId,tokenIndex,splitPosition},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
  // Fetch current subtitle
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the fetched subtitle to ensure format matches (mediaId_index, not mediaId-index)
  const exactSubtitleId = subtitle.id;
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Attempting to save split token',data:{subtitleId,exactSubtitleId,tokenCount:serializableTokens.length,idMatches:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', exactSubtitleId) // Use exact ID from fetched subtitle to ensure format matches
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Failed to save split token',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save split token: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save split token: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Exception during split token save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(exactSubtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === exactSubtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:splitToken',message:'Successfully split token',data:{subtitleId,exactSubtitleId,tokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Conjoining tokens',data:{subtitleId,startTokenIndex,endTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Failed to fetch subtitle',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate subtitle
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // CRITICAL: Use the exact ID from the fetched subtitle to ensure format matches (mediaId_index, not mediaId-index)
  const exactSubtitleId = subtitle.id;
  
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Attempting to save conjoined tokens',data:{subtitleId,exactSubtitleId,tokenCount:serializableTokens.length,idMatches:subtitleId === exactSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    
    const { error: saveError, data: saveData } = await supabase
      .from('subtitles_th')
      .update({
        tokens_th: {
          tokens: serializableTokens,
        },
      })
      .eq('id', exactSubtitleId) // Use exact ID from fetched subtitle to ensure format matches
      .select()
      .single();
    
    if (saveError) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Failed to save conjoined tokens',data:{subtitleId,error:saveError.message,code:saveError.code,details:saveError.details,hint:saveError.hint},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save conjoined tokens: ${saveError.message} (code: ${saveError.code})`);
    }
    
    // Verify save succeeded
    if (!saveData) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'No data returned from update',data:{subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to save conjoined tokens: No data returned from update`);
    }
    
    // Validate verified subtitle from DB response
    verifiedSubtitle = subtitleThSchema.parse(saveData);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Exception during conjoined tokens save',data:{subtitleId,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw - if DB save fails, cache should NOT be updated
  }
  
  const mediaId = getMediaIdFromSubtitleId(exactSubtitleId);
  if (mediaId) {
    updateSubtitlesCache(mediaId, (current) => {
      const idx = current.findIndex((sub) => sub.id === exactSubtitleId);
      if (idx === -1) return current;
      const updated = [...current];
      updated[idx] = verifiedSubtitle;
      return updated;
    });
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subtitleEditor.ts:conjoinTokens',message:'Successfully conjoined tokens',data:{subtitleId,exactSubtitleId,startTokenIndex,endTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
  // #endregion
  
  return verifiedSubtitle;
}

