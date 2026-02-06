/**
 * Supabase Database Service
 * 
 * All database operations using Supabase (PostgreSQL)
 * Tables: episodes, subtitles_th, words_th, meanings_th
 * 
 * ⚠️ DATA INTEGRITY: All queries in this file are DIRECT database calls.
 * - NO client-side caching (Supabase client doesn't cache by default)
 * - NO localStorage or sessionStorage usage
 * - Each query is a fresh HTTP request to Supabase
 * 
 * For data integrity checks, these functions always return the latest data from the database.
 */

import { createClient } from '@supabase/supabase-js';
import { subtitleThSchema, type SubtitleTh } from '../schemas/subtitleThSchema';
import { episodeSchema, type Episode } from '../schemas/episodeSchema';
import { wordThSchema, type WordTh } from '../schemas/wordThSchema';
import { meaningThSchema, type MeaningTh } from '../schemas/meaningThSchema';

// Supabase connection
// ⚠️ Direct database connection - no caching layer
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch subtitles for an episode by media ID
 * 
 * 📋 Validates against: src/schemas/subtitleThSchema.ts
 * Returns array that should be validated with subtitleThSchema[] before use
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 * - No caching, no localStorage, always fresh from database
 */
export async function fetchSubtitles(mediaId: string): Promise<SubtitleTh[]> {
  console.log('[DEBUG] fetchSubtitles called with mediaId:', mediaId);
  
  // Subtitles_th table columns: id, thai, start_sec_th, end_sec_th, tokens_th (snake_case)
  // Filter subtitles by id pattern: `${mediaId}_${index}`
  const { data, error } = await supabase
    .from('subtitles_th')
    .select('*')
    .order('start_sec_th', { ascending: true });
  
  console.log('[DEBUG] fetchSubtitles - ALL subtitles from DB:', {
    dataCount: data?.length || 0, 
    error: error?.message, 
    firstSubtitle: data?.[0],
    allIds: data?.slice(0, 20).map((s: any) => s.id),
    mediaIdLookingFor: mediaId
  });
  
  if (error) {
    console.error('[DEBUG] fetchSubtitles error:', error);
    throw error;
  }
  
  if (!data || data.length === 0) {
    console.warn('[DEBUG] fetchSubtitles: No subtitles found in database at all');
    return [];
  }
  
  // Filter by mediaId - subtitle IDs are formatted as `${mediaId}_${index}` (e.g., "Frieren: Beyond Journey's End_0")
  // Check if subtitle id starts with mediaId (exact prefix match)
  const filtered = (data || []).filter((sub: any) => {
    const subId = sub.id?.toString() || '';
    // Exact prefix match: subtitle ID should start with mediaId followed by underscore
    const matches = subId.startsWith(mediaId + '_') || subId === mediaId;
    return matches;
  });
  
  // Client-side sorting fallback to ensure proper chronological order
  const sorted = filtered.sort((a: any, b: any) => {
    const aTime = a.start_sec_th || 0;
    const bTime = b.start_sec_th || 0;
    return aTime - bTime;
  });
  
  console.log('[DEBUG] fetchSubtitles filtered result:', {
    originalCount: data?.length || 0, 
    filteredCount: sorted.length, 
    mediaId,
    sampleOriginalIds: data?.slice(0, 5).map((s: any) => s.id),
    filteredIds: sorted.slice(0, 5).map((s: any) => s.id),
    firstFilteredSubtitle: sorted[0]
  });
  
  // If no matches, log for debugging but return empty (don't return all - that's wrong data)
  if (sorted.length === 0 && data.length > 0) {
    console.warn('[DEBUG] fetchSubtitles: No subtitles matched mediaId filter');
    console.warn('[DEBUG] MediaId was:', mediaId);
    console.warn('[DEBUG] Sample subtitle IDs in DB:', data.slice(0, 10).map((s: any) => s.id));
    console.warn('[DEBUG] Looking for IDs starting with or containing:', mediaId);
  }
  
  // Validate with Zod schema before returning
  return sorted.map(sub => subtitleThSchema.parse(sub));
}

/**
 * Fetch an episode by show name and media ID
 * 
 * 📋 Validates against: src/schemas/episodeSchema.ts
 * Returns data that should be validated with episodeSchema before use
 */
export async function fetchEpisode(showName: string, mediaId: string): Promise<Episode | null> {
  console.log('[DEBUG] fetchEpisode called with:', {showName, mediaId});
  
  // Zod schema field names: show_title, media_id
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('show_title', showName) // Zod schema: show_title
    .eq('media_id', mediaId) // Zod schema: media_id
    .single();
  
  console.log('[DEBUG] fetchEpisode result:', {found: !!data, error: error?.message, data: data ? Object.keys(data) : null});
  
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  
  // Validate with Zod schema before returning
  return episodeSchema.parse(data);
}

/**
 * Fetch episode lookups (list of episodes)
 */
export async function fetchEpisodeLookups(limitCount: number = 10) {
  console.log('[DEBUG] fetchEpisodeLookups called with limitCount:', limitCount);
  
  // Query episodes table
  // Columns: id (bigint), media_id (text), show_title (text), season_number (numeric), episode_number (numeric), episode_title (text)
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .limit(limitCount);
  
  console.log('[DEBUG] fetchEpisodeLookups raw result:', {dataCount: data?.length || 0, error: error?.message, firstEpisode: data?.[0]});
  
  if (error) {
    console.error('[DEBUG] fetchEpisodeLookups error:', error);
    throw error;
  }
  
  // Map episodes table format to EpisodeLookup format expected by the app
  // Database columns → EpisodeLookup interface:
  // id (bigint) → id (string)
  // media_id (text) → mediaId (string)
  // show_title (text) → showName (string)
  // season_number (numeric) → season (number)
  // episode_number (numeric) → episode (number)
  // episode_title (text) → episodeTitle (string)
  const mapped = (data || []).map((ep: any) => ({
    id: ep.id?.toString() || ep.media_id, // Convert bigint to string, fallback to media_id
    mediaId: ep.media_id, // camelCase for EpisodeLookup interface
    showName: ep.show_title || '', // camelCase for EpisodeLookup interface
    season: ep.season_number != null ? Number(ep.season_number) : undefined,
    episode: ep.episode_number != null ? Number(ep.episode_number) : undefined,
    episodeTitle: ep.episode_title || undefined, // camelCase for EpisodeLookup interface
  }));
  
  console.log('[DEBUG] fetchEpisodeLookups mapped result:', {originalCount: data?.length || 0, mappedCount: mapped.length, firstMapped: mapped[0]});
  
  return mapped;
}

/**
 * Save multiple subtitles in batch
 * Validates each subtitle with subtitleThSchema before insertion
 * 
 * 📋 Validates against: src/schemas/subtitleThSchema.ts
 */
export async function saveSubtitlesBatch(subtitles: SubtitleTh[]): Promise<void> {
  console.log(`[Save] Saving ${subtitles?.length || 0} subtitles to Supabase`);
  
  if (!subtitles || subtitles.length === 0) {
    return;
  }

  // Validate all subtitles with Zod schema
  const validatedSubtitles = subtitles.map((sub, index) => {
    try {
      const validated = subtitleThSchema.parse(sub);
      return validated;
    } catch (error) {
      console.error(`[Save] Subtitle ${sub.id} validation failed:`, error);
      throw error;
    }
  });

  const subtitleDataArray = validatedSubtitles.map(validated => ({
    id: validated.id,
    thai: validated.thai,
    start_sec_th: validated.start_sec_th !== undefined ? validated.start_sec_th : null,
    end_sec_th: validated.end_sec_th !== undefined ? validated.end_sec_th : null,
    tokens_th: validated.tokens_th || null,
  }));

  console.log(`[Save] Upserting ${subtitleDataArray.length} subtitles to 'subtitles_th' table`);

  const { error, data } = await supabase
    .from('subtitles_th')
    .upsert(subtitleDataArray, { onConflict: 'id' })
    .select();

  if (error) {
    console.error(`[Save] ✗ Failed to save subtitles:`, error);
    throw new Error(`Failed to save subtitles batch: ${error.message}`);
  }

  console.log(`[Save] ✓ Successfully saved ${data?.length || subtitleDataArray.length} subtitles to Supabase`);
}

/**
 * Save token meaning selection to subtitles_th.tokens_th
 * Updates the token at the specified index with meaning_id
 * 
 * 📋 Validates against: src/schemas/subtitleThSchema.ts
 */
export async function saveTokenMeaningSelection(
  subtitleId: string,
  tokenIndex: number,
  meaningId: bigint
): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Function entry',data:{subtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  
  console.log(`[Save] Saving meaning selection for subtitle ${subtitleId}, token index ${tokenIndex}, meaning_id ${meaningId}`);
  
  // Fetch current subtitle
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Fetching subtitle from DB',data:{subtitleId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  const { data: subtitleData, error: fetchError } = await supabase
    .from('subtitles_th')
    .select('*')
    .eq('id', subtitleId)
    .single();
  
  if (fetchError) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Fetch error',data:{subtitleId,error:fetchError.message,code:fetchError.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    console.error(`[Save] Failed to fetch subtitle:`, fetchError);
    throw new Error(`Failed to fetch subtitle: ${fetchError.message}`);
  }
  
  if (!subtitleData) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Subtitle not found',data:{subtitleId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    throw new Error(`Subtitle ${subtitleId} not found`);
  }
  
  // Validate and normalize subtitle
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Validating subtitle',data:{subtitleId,hasTokensTh:!!subtitleData.tokens_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  const subtitle = subtitleThSchema.parse(subtitleData);
  
  // Ensure tokens_th exists and has tokens
  if (!subtitle.tokens_th || !subtitle.tokens_th.tokens) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'No tokens found',data:{subtitleId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    throw new Error(`Subtitle ${subtitleId} has no tokens`);
  }
  
  const tokens = subtitle.tokens_th.tokens;
  
  // Validate token index
  if (tokenIndex < 0 || tokenIndex >= tokens.length) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Token index out of range',data:{subtitleId,tokenIndex,tokenCount:tokens.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    throw new Error(`Token index ${tokenIndex} out of range (0-${tokens.length - 1})`);
  }
  
  // Normalize tokens to TokenObject[] format
  // #region agent log
  const beforeNormalize = tokens.map((t, i) => ({ idx: i, type: typeof t, isString: typeof t === 'string', hasMeaningId: typeof t === 'object' && 'meaning_id' in (t as any) }));
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Before normalization',data:{subtitleId,tokenIndex,tokenCount:tokens.length,tokens:beforeNormalize},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  const normalizedTokens = tokens.map((token, idx) => {
    if (typeof token === 'string') {
      return { t: token };
    }
    return token;
  });
  
  // Update token at index with meaning_id
  // Convert BigInt to number for JSON serialization (Supabase expects number, not BigInt object)
  // Check if BigInt fits in safe integer range, otherwise use string
  const meaningIdValue = meaningId <= BigInt(Number.MAX_SAFE_INTEGER) 
    ? Number(meaningId) 
    : meaningId.toString();
  
  normalizedTokens[tokenIndex] = {
    ...normalizedTokens[tokenIndex],
    meaning_id: meaningIdValue as any, // Zod will coerce this back to bigint during validation
  };
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'After updating token',data:{subtitleId,tokenIndex,meaningIdValue,meaningIdOriginal:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  
  // Create updated subtitle with normalized tokens
  const updatedSubtitle = {
    ...subtitle,
    tokens_th: {
      tokens: normalizedTokens,
    },
  };
  
  // Validate updated subtitle
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Validating updated subtitle',data:{subtitleId,tokenCount:normalizedTokens.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  const validated = subtitleThSchema.parse(updatedSubtitle);
  
  // Convert BigInt values to numbers/strings for JSON serialization before saving
  const serializableTokens = validated.tokens_th!.tokens.map((token) => {
    if (typeof token === 'string') {
      return token;
    }
    const tokenObj = token as { t: string; meaning_id?: bigint };
    if (tokenObj.meaning_id !== undefined) {
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
  
  // Save to database
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Saving to DB',data:{subtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  const { error: saveError } = await supabase
    .from('subtitles_th')
    .update({
      tokens_th: {
        tokens: serializableTokens,
      },
    })
    .eq('id', subtitleId);
  
  if (saveError) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Save error',data:{subtitleId,error:saveError.message,code:saveError.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    console.error(`[Save] ✗ Failed to save token meaning selection:`, saveError);
    throw new Error(`Failed to save token meaning selection: ${saveError.message}`);
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveTokenMeaningSelection',message:'Function exit - success',data:{subtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] ✓ Successfully saved meaning selection for subtitle ${subtitleId}, token index ${tokenIndex}`);
}

/**
 * Fetch word from words_th table by word_th (primary key)
 * 
 * 📋 Validates against: src/schemas/wordThSchema.ts
 * Returns data validated with wordThSchema before returning
 */
export async function fetchWord(wordTh: string): Promise<WordTh | null> {
  console.log('[DEBUG] fetchWord called with wordTh:', wordTh);
  
  const { data: dataArray, error } = await supabase
    .from('words_th')
    .select('word_th, g2p, phonetic_en')
    .eq('word_th', wordTh)
    .limit(1);
  
  const data = dataArray && dataArray.length > 0 ? dataArray[0] : null;
  
  console.log('[DEBUG] fetchWord result:', {wordTh, found: !!data, error: error?.message});
  
  if (error && error.code !== 'PGRST116') {
    throw error;
  }
  
  if (!data) {
    return null;
  }
  
  // Normalize null to undefined for optional fields (Zod expects undefined, not null)
  if (data.g2p === null) data.g2p = undefined;
  if (data.phonetic_en === null) data.phonetic_en = undefined;
  
  // Validate with Zod schema before returning
  try {
    return wordThSchema.parse(data);
  } catch (error) {
    console.error(`[Fetch] Word validation failed for "${wordTh}":`, error);
    throw error;
  }
}

/**
 * Generate a deterministic numeric ID from a word and index
 * Uses the same hash function as fetchOrstMeanings to ensure consistency
 */
function generateSenseId(textTh: string, index: number): string {
  const idPattern = `${textTh}-${index}`;
  let hash = 0;
  for (let i = 0; i < idPattern.length; i++) {
    const char = idPattern.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure positive and add index for uniqueness
  const numericId = Math.abs(hash) * 1000 + index;
  return numericId.toString();
}

/**
 * Fetch meanings (senses) for a word from meanings_th table
 * 
 * 📋 Validates against: src/schemas/meaningThSchema.ts
 * Returns array validated with meaningThSchema before returning
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 */
export async function fetchSenses(textTh: string): Promise<MeaningTh[]> {
  console.log('[DEBUG] fetchSenses called with textTh:', textTh);
  
  // Generate possible sense IDs for this word (indices 0-20, reasonable max)
  const possibleIds: string[] = [];
  for (let index = 0; index <= 20; index++) {
    possibleIds.push(generateSenseId(textTh, index));
  }
  
  // Query meanings by exact IDs
  const { data, error } = await supabase
    .from('meanings_th')
    .select('*')
    .in('id', possibleIds);
  
  console.log('[DEBUG] fetchSenses fetched:', {textTh, dataCount: data?.length || 0, error: error?.message});
  
  if (error) throw error;
  
  // Normalize null to undefined and fix datetime format for optional fields
  const normalizedData = (data || []).map((sense) => {
    if (sense.word_th_id === null) sense.word_th_id = undefined;
    if (sense.source === null) sense.source = undefined;
    
    // Normalize created_at: convert Date objects to ISO string, null to undefined, invalid strings to undefined
    if (sense.created_at === null) {
      sense.created_at = undefined;
    } else if (sense.created_at instanceof Date) {
      sense.created_at = sense.created_at.toISOString();
    } else if (typeof sense.created_at === 'string') {
      try {
        const date = new Date(sense.created_at);
        if (isNaN(date.getTime())) {
          sense.created_at = undefined;
        } else {
          sense.created_at = date.toISOString();
        }
      } catch (e) {
        sense.created_at = undefined;
      }
    }
    
    // Validate with Zod schema before returning
    try {
      return meaningThSchema.parse(sense);
    } catch (error) {
      console.error(`[Fetch] Sense validation failed for "${textTh}":`, error);
      return null;
    }
  }).filter((sense): sense is MeaningTh => sense !== null);
  
  return normalizedData;
}

/**
 * Fetch meanings for a word from meanings_th table by word_th_id
 * 
 * 📋 Validates against: src/schemas/meaningThSchema.ts
 * Returns array validated with meaningThSchema before returning
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 */
export async function fetchMeaningsByWordTh(wordTh: string): Promise<MeaningTh[]> {
  console.log('[DEBUG] fetchMeaningsByWordTh called with wordTh:', wordTh);
  
  // Query meanings_th where word_th_id matches the Thai word
  const { data, error } = await supabase
    .from('meanings_th')
    .select('*')
    .eq('word_th_id', wordTh);
  
  console.log('[DEBUG] fetchMeaningsByWordTh fetched:', {wordTh, dataCount: data?.length || 0, error: error?.message});
  
  if (error) throw error;
  
  // Normalize null to undefined and fix datetime format for optional fields
  const normalizedData = (data || []).map((meaning) => {
    if (meaning.word_th_id === null) meaning.word_th_id = undefined;
    if (meaning.source === null) meaning.source = undefined;
    
    // Normalize created_at: convert Date objects to ISO string, null to undefined, invalid strings to undefined
    if (meaning.created_at === null) {
      meaning.created_at = undefined;
    } else if (meaning.created_at instanceof Date) {
      meaning.created_at = meaning.created_at.toISOString();
    } else if (typeof meaning.created_at === 'string') {
      try {
        const date = new Date(meaning.created_at);
        if (isNaN(date.getTime())) {
          meaning.created_at = undefined;
        } else {
          meaning.created_at = date.toISOString();
        }
      } catch (e) {
        meaning.created_at = undefined;
      }
    }
    
    // Validate with Zod schema before returning
    try {
      return meaningThSchema.parse(meaning);
    } catch (error) {
      console.error(`[Fetch] Meaning validation failed for "${wordTh}":`, error);
      return null;
    }
  }).filter((meaning): meaning is MeaningTh => meaning !== null);
  
  return normalizedData;
}

/**
 * Save word data only (without senses) to words_th table
 * word_th is the primary key, preventing duplicate words
 */
export async function saveWordOnly(wordData: {
  word_th: string;
  g2p?: string;
  phonetic_en?: string;
}): Promise<WordTh> {
  console.log(`[Save] Saving word "${wordData.word_th}" to words_th`);
  
  if (!wordData.word_th) {
    throw new Error('word_th is required');
  }

  // Validate word data with Zod before saving
  const validatedWord = wordThSchema.parse({
    word_th: wordData.word_th,
    g2p: wordData.g2p,
    phonetic_en: wordData.phonetic_en,
  });

  const wordRowData: {
    word_th: string;
    g2p?: string;
    phonetic_en?: string;
  } = {
    word_th: validatedWord.word_th,
    ...(validatedWord.g2p !== undefined && { g2p: validatedWord.g2p }),
    ...(validatedWord.phonetic_en !== undefined && { phonetic_en: validatedWord.phonetic_en }),
  };

  // Try upsert with word_th as conflict target
  let { error: wordError, data: savedWordData } = await supabase
    .from('words_th')
    .upsert(wordRowData, { onConflict: 'word_th' })
    .select();
  
  // If upsert fails due to missing constraint, fall back to manual insert/update
  if (wordError && wordError.code === '42P10') {
    const { data: existingWord } = await supabase
      .from('words_th')
      .select('word_th')
      .eq('word_th', wordData.word_th)
      .limit(1)
      .single();
    
    if (existingWord) {
      const { error: updateError, data: updateData } = await supabase
        .from('words_th')
        .update(wordRowData)
        .eq('word_th', wordData.word_th)
        .select();
      wordError = updateError;
      savedWordData = updateData;
    } else {
      const { error: insertError, data: insertData } = await supabase
        .from('words_th')
        .insert(wordRowData)
        .select();
      wordError = insertError;
      savedWordData = insertData;
    }
  }
  
  if (wordError) {
    console.error(`[Save] ✗ Failed to save word:`, wordError);
    throw new Error(`Failed to save word: ${wordError.message}`);
  }
  
  console.log(`[Save] ✓ Successfully saved word "${wordData.word_th}" to words_th`);
  
  if (!savedWordData?.[0]?.word_th) {
    throw new Error(`Failed to get saved word word_th for "${wordData.word_th}"`);
  }
  
  return wordThSchema.parse(savedWordData[0]);
}

/**
 * Save senses (meanings) to meanings_th table
 * 
 * 📋 Validates against: src/schemas/meaningThSchema.ts
 */
export async function saveSenses(
  senses: Array<{
    id: bigint;
    definition_th: string;
    source?: string;
    created_at?: string;
    word_th_id?: string;
  }>,
  wordTh?: string
): Promise<void> {
  console.log(`[Save] Saving ${senses.length} senses to meanings_th table`);
  
  if (!senses || senses.length === 0) {
    return;
  }

  // Validate senses with Zod before saving
  const validatedSenses = senses.map((sense, index) => {
    try {
      return meaningThSchema.parse(sense);
    } catch (error) {
      console.error(`[Save] Sense ${index} validation failed:`, error);
      throw error;
    }
  });

  const meaningData = validatedSenses.map((sense) => ({
    id: sense.id.toString(),
    definition_th: sense.definition_th,
    word_th_id: sense.word_th_id || null,
    source: sense.source || null,
    created_at: sense.created_at || null,
  }));

  // Check which meanings already exist
  const meaningIds = meaningData.map(m => m.id);
  const { data: existingMeanings, error: checkError } = await supabase
    .from('meanings_th')
    .select('id')
    .in('id', meaningIds);
  
  if (checkError) {
    console.warn(`[Save] ⚠ Warning: Failed to check existing meanings: ${checkError.message}. Proceeding with upsert.`);
  }
  
  const existingIdSet = new Set(existingMeanings?.map(m => m.id) || []);
  const newMeanings = meaningData.filter(m => !existingIdSet.has(m.id));
  const skippedCount = meaningData.length - newMeanings.length;
  
  if (skippedCount > 0) {
    console.log(`[Save] ⚡ Skipping ${skippedCount} meanings that already exist in database`);
  }
  
  if (newMeanings.length === 0) {
    console.log(`[Save] ✓ All ${meaningData.length} meanings already exist in database - no insert needed`);
    return;
  }

  const { error: meaningsError, data: meaningsData } = await supabase
    .from('meanings_th')
    .upsert(newMeanings, { onConflict: 'id' })
    .select();
  
  if (meaningsError) {
    if (meaningsError.code === '23505' || meaningsError.message.includes('duplicate') || meaningsError.message.includes('unique')) {
      console.warn(`[Save] ⚠ Duplicate key violation - meanings already exist. Skipping.`);
      return;
    }
    console.error(`[Save] ✗ Failed to save meanings:`, meaningsError);
    throw new Error(`Failed to save meanings: ${meaningsError.message}`);
  }
  
  console.log(`[Save] ✓ Successfully saved ${meaningsData?.length || newMeanings.length} new meanings to meanings_th table (${skippedCount} already existed)`);
}
