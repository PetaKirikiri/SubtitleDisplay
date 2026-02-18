/**
 * Central TanStack Query Layer - Local-First Policy
 *
 * Single source of truth for all cache operations:
 * - All reads: cache-first; return cached immediately, refetch in background
 * - All writes: optimistic update first, persist in background
 * - Never: invalidateQueries for user-triggered writes
 * - Subtitles: dual-cache sync with subtitleNavigation
 */

import { queryClient } from './queryClient';
import { setSubtitleCache, getSubtitleCache } from '../services/cache/subtitleNavigation';
import type { SubtitleTh } from '../schemas/subtitleThSchema';

export const QUERY_KEYS = {
  subtitles: (mediaId: string) => ['subtitles', mediaId] as const,
  meanings: (wordTh: string) => ['meanings', wordTh] as const,
  userWords: (userId: string) => ['userWords', userId] as const,
} as const;

export const STALE_TIMES = {
  subtitles: 30_000,
  meanings: 5 * 60_000,
  userWords: 60_000,
} as const;

/**
 * Read policy: cache-first
 * Returns cached data immediately if present, triggers background refetch
 */
export async function readQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  staleTime: number
): Promise<T> {
  const cached = queryClient.getQueryData<T>(queryKey);

  if (cached !== undefined) {
    queryClient.fetchQuery({ queryKey, queryFn, staleTime }).catch(() => {});
    return cached;
  }

  return queryClient.fetchQuery({
    queryKey,
    queryFn,
    staleTime,
  });
}

/**
 * Write policy: optimistic update
 * Updates cache immediately
 */
export function writeOptimistic<T>(
  queryKey: readonly unknown[],
  updater: (prev: T | undefined) => T
): void {
  queryClient.setQueryData(queryKey, updater);
}

/**
 * Write policy: persist in background
 * Fires persistFn, on success updates cache with result
 */
export function writeInBackground<T>(
  queryKey: readonly unknown[],
  persistFn: () => Promise<T>,
  onSuccess?: (result: T) => void
): void {
  persistFn()
    .then((result) => {
      if (onSuccess) onSuccess(result);
    })
    .catch((err) => {
      console.error('[tanstackOperations] writeInBackground failed:', err);
    });
}

/**
 * Dual-cache sync: update both TanStack and subtitleNavigation for subtitles
 */
export function updateSubtitlesCache(
  mediaId: string,
  updater: (prev: SubtitleTh[]) => SubtitleTh[]
): void {
  const prev =
    queryClient.getQueryData<SubtitleTh[]>(QUERY_KEYS.subtitles(mediaId)) ??
    getSubtitleCache();
  const updated = updater(prev);
  queryClient.setQueryData(QUERY_KEYS.subtitles(mediaId), updated);
  setSubtitleCache(updated);
}

/**
 * Sync subtitle cache from TanStack to subtitleNavigation
 */
export function syncSubtitleCache(mediaId: string): void {
  const data = queryClient.getQueryData<SubtitleTh[]>(QUERY_KEYS.subtitles(mediaId));
  if (data) setSubtitleCache(data);
}
