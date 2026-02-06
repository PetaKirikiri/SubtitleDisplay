/**
 * TanStack Query utilities for subtitles
 * 
 * These functions use TanStack Query's imperative API (not React hooks)
 * since this is a Chrome extension context
 */

import { queryClient } from '../lib/queryClient';
import { fetchSubtitles, saveSubtitlesBatch } from '../supabase';
import { type SubtitleTh } from '../schemas/subtitleThSchema';

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
