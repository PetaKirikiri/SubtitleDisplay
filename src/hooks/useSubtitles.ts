/**
 * TanStack Query utilities for subtitles and meanings
 * 
 * These functions use TanStack Query's imperative API (not React hooks)
 * since this is a Chrome extension context
 * 
 * 🔄 ARCHITECTURE: TanStack Query → Supabase Client Functions → Supabase REST API → PostgreSQL
 *                                    ↑
 *                            Drizzle Schema (type definitions & relations)
 * 
 * - TanStack Query handles caching and state management
 * - Supabase client executes queries (browser-compatible)
 * - Drizzle schemas provide type definitions and relation shapes
 * - Zod schemas validate data before/after database operations
 * 
 * Pattern matches SmarterSubs architecture:
 * - Drizzle schemas define table structures and relations (for type safety and migrations)
 * - Supabase client executes queries (browser-compatible, no direct Postgres connection needed)
 * - TanStack Query wraps Supabase functions for caching and state management
 */

import { queryClient } from '../lib/queryClient';
import { fetchSubtitles, saveSubtitlesBatch, fetchMeaningsByWordTh, saveTokenMeaningSelection } from '../supabase';
import { type SubtitleTh } from '../schemas/subtitleThSchema';
import { type MeaningTh } from '../schemas/meaningThSchema';

/**
 * Fetch subtitles for a media ID using TanStack Query
 * Returns cached data if available, otherwise fetches fresh data
 */
export async function getSubtitles(mediaId: string): Promise<SubtitleTh[]> {
  return queryClient.fetchQuery({
    queryKey: ['subtitles', mediaId],
    queryFn: () => fetchSubtitles(mediaId),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch meanings for a word using TanStack Query (cache-first)
 * Returns cached data immediately if available, otherwise fetches fresh data
 * Uses longer stale time since meanings don't change frequently
 * This ensures instant UI updates when meanings are already cached
 */
export async function getMeanings(wordTh: string): Promise<MeaningTh[]> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:getMeanings',message:'Function entry',data:{wordTh},timestamp:Date.now(),runId:'run1',hypothesisId:'CACHE'})}).catch(()=>{});
  // #endregion
  
  // Check cache first for instant response
  const cached = queryClient.getQueryData<MeaningTh[]>(['meanings', wordTh]);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:getMeanings',message:'Cache check result',data:{wordTh,hasCached:!!cached,cachedCount:cached?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'CACHE'})}).catch(()=>{});
  // #endregion
  
  if (cached) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:getMeanings',message:'Returning cached data immediately',data:{wordTh,cachedCount:cached.length},timestamp:Date.now(),runId:'run1',hypothesisId:'CACHE'})}).catch(()=>{});
    // #endregion
    // Return cached data immediately, then refetch in background if stale
    queryClient.fetchQuery({
      queryKey: ['meanings', wordTh],
      queryFn: () => fetchMeaningsByWordTh(wordTh),
      staleTime: 5 * 60 * 1000, // 5 minutes - meanings rarely change
    }).catch(() => {}); // Don't await - return cached data immediately
    return cached;
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:getMeanings',message:'No cache - fetching fresh data',data:{wordTh},timestamp:Date.now(),runId:'run1',hypothesisId:'CACHE'})}).catch(()=>{});
  // #endregion
  // No cache - fetch fresh data
  const result = await queryClient.fetchQuery({
    queryKey: ['meanings', wordTh],
    queryFn: () => fetchMeaningsByWordTh(wordTh),
    staleTime: 5 * 60 * 1000, // 5 minutes - meanings rarely change
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache longer
  });
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:getMeanings',message:'Fresh data fetched',data:{wordTh,resultCount:result.length},timestamp:Date.now(),runId:'run1',hypothesisId:'CACHE'})}).catch(()=>{});
  // #endregion
  return result;
}

/**
 * Prefetch meanings for a word (useful for background loading)
 * Doesn't block - returns immediately if already cached
 */
export async function prefetchMeanings(wordTh: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ['meanings', wordTh],
    queryFn: () => fetchMeaningsByWordTh(wordTh),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Save subtitles and invalidate cache
 * Invalidates the subtitles query cache after successful save
 */
export async function saveSubtitles(
  subtitles: SubtitleTh[],
  mediaId: string
): Promise<void> {
  // Save subtitles directly
  await saveSubtitlesBatch(subtitles);
  
  // Invalidate and refetch subtitles for this mediaId
  await queryClient.invalidateQueries({ queryKey: ['subtitles', mediaId] });
}

/**
 * Prefetch subtitles for a media ID (useful for background loading)
 */
export async function prefetchSubtitles(mediaId: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ['subtitles', mediaId],
    queryFn: () => fetchSubtitles(mediaId),
    staleTime: 30 * 1000,
  });
}

/**
 * Invalidate meanings cache for a word
 * Use this after creating, updating, or deleting meanings
 */
export async function invalidateMeanings(wordTh: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['meanings', wordTh] });
}

/**
 * Save token meaning selection using TanStack Query mutation
 * CRITICAL: All database writes must go through TanStack Query mutations
 * This ensures proper cache invalidation and state management
 * 
 * @param subtitleId - Subtitle ID
 * @param tokenIndex - Token index
 * @param meaningId - Meaning ID to assign
 * @param mediaId - Media ID (for cache invalidation)
 * @returns Verified subtitle from DB
 */
export async function saveTokenMeaning(
  subtitleId: string,
  tokenIndex: number,
  meaningId: bigint,
  mediaId: string
): Promise<SubtitleTh> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:saveTokenMeaning',message:'TANSTACK_MUTATION_START',data:{subtitleId,tokenIndex,meaningId:meaningId.toString(),mediaId},timestamp:Date.now(),runId:'run1',hypothesisId:'TANSTACK'})}).catch(()=>{});
  // #endregion
  
  // Execute mutation using TanStack Query
  const verifiedSubtitle = await queryClient.fetchQuery({
    queryKey: ['mutation', 'saveTokenMeaning', subtitleId, tokenIndex, meaningId.toString()],
    queryFn: async () => {
      // Call the actual DB save function
      const result = await saveTokenMeaningSelection(subtitleId, tokenIndex, meaningId);
      
      // CRITICAL: Invalidate subtitles cache after successful save
      // This ensures next fetch will get fresh data from DB
      await queryClient.invalidateQueries({ queryKey: ['subtitles', mediaId] });
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useSubtitles.ts:saveTokenMeaning',message:'TANSTACK_MUTATION_SUCCESS_CACHE_INVALIDATED',data:{subtitleId,tokenIndex,meaningId:meaningId.toString(),mediaId},timestamp:Date.now(),runId:'run1',hypothesisId:'TANSTACK'})}).catch(()=>{});
      // #endregion
      
      return result;
    },
    staleTime: 0, // Mutations are never cached
  });
  
  return verifiedSubtitle;
}
