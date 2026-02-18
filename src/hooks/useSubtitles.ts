/**
 * TanStack Query utilities for subtitles and meanings
 * Thin wrapper over central tanstackOperations layer
 */

import { queryClient } from '../lib/queryClient';
import {
  QUERY_KEYS,
  STALE_TIMES,
  readQuery,
  writeOptimistic,
  writeInBackground,
  updateSubtitlesCache,
} from '../lib/tanstackOperations';
import { fetchSubtitles, saveSubtitlesBatch, fetchMeaningsByWordTh, saveTokenMeaningSelection } from '../supabase';
import { saveSubtitlesBatch as saveSubtitlesBatchWithPreserve } from '../services/supabaseClient';
import { type SubtitleTh } from '../schemas/subtitleThSchema';
import { type MeaningTh } from '../schemas/meaningThSchema';

export async function getSubtitles(mediaId: string): Promise<SubtitleTh[]> {
  return readQuery(
    QUERY_KEYS.subtitles(mediaId),
    () => fetchSubtitles(mediaId),
    STALE_TIMES.subtitles
  );
}

export async function getMeanings(wordTh: string): Promise<MeaningTh[]> {
  return readQuery(
    QUERY_KEYS.meanings(wordTh),
    () => fetchMeaningsByWordTh(wordTh),
    STALE_TIMES.meanings
  );
}

export function updateTokenMeaningOptimistic(
  subtitleId: string,
  tokenIndex: number,
  meaningId: bigint,
  mediaId: string
): void {
  updateSubtitlesCache(mediaId, (currentData) => {
    if (currentData.length === 0) return currentData;
    return currentData.map((sub) => {
      if (sub.id !== subtitleId) return sub;
      const tokens = sub.tokens_th?.tokens;
      if (!tokens || tokenIndex >= tokens.length) return sub;
      const newTokens = tokens.map((t, i) => {
        if (i !== tokenIndex) return t;
        const tokenObj = typeof t === 'string' ? { t: t } : { ...t };
        return { ...tokenObj, meaning_id: meaningId };
      });
      return { ...sub, tokens_th: { ...sub.tokens_th, tokens: newTokens } };
    });
  });
}

export function saveTokenMeaningInBackground(
  subtitleId: string,
  tokenIndex: number,
  meaningId: bigint,
  mediaId: string
): void {
  writeInBackground(
    QUERY_KEYS.subtitles(mediaId),
    () => saveTokenMeaningSelection(subtitleId, tokenIndex, meaningId),
    (result) => {
      updateSubtitlesCache(mediaId, (current) =>
        current.map((sub) => (sub.id === subtitleId ? result : sub))
      );
    }
  );
}

export async function prefetchMeanings(wordTh: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: QUERY_KEYS.meanings(wordTh),
    queryFn: () => fetchMeaningsByWordTh(wordTh),
    staleTime: STALE_TIMES.meanings,
  });
}

/**
 * Save subtitles - local-first: optimistic update, then persist in background
 */
export function saveSubtitles(subtitles: SubtitleTh[], mediaId: string): void {
  updateSubtitlesCache(mediaId, () => subtitles);
  writeInBackground(QUERY_KEYS.subtitles(mediaId), () => saveSubtitlesBatch(subtitles));
}

/**
 * Save subtitles (blocking) - for flows that need to await completion (e.g. extractAndSave)
 * @param preserveTokens - If true, preserves existing tokens_th when upserting (extract flow)
 */
export async function saveSubtitlesAndAwait(
  subtitles: SubtitleTh[],
  mediaId: string,
  preserveTokens = false
): Promise<void> {
  updateSubtitlesCache(mediaId, () => subtitles);
  if (preserveTokens) {
    await saveSubtitlesBatchWithPreserve(subtitles, true);
  } else {
    await saveSubtitlesBatch(subtitles);
  }
  updateSubtitlesCache(mediaId, () => subtitles);
}

export async function prefetchSubtitles(mediaId: string): Promise<void> {
  const { queryClient } = await import('../lib/queryClient');
  await queryClient.prefetchQuery({
    queryKey: QUERY_KEYS.subtitles(mediaId),
    queryFn: () => fetchSubtitles(mediaId),
    staleTime: STALE_TIMES.subtitles,
  });
}

/**
 * Update meanings cache (use setQueryData instead of invalidate)
 */
export function setMeaningsCache(wordTh: string, meanings: MeaningTh[]): void {
  writeOptimistic(QUERY_KEYS.meanings(wordTh), () => meanings);
}

export async function invalidateMeanings(wordTh: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.meanings(wordTh) });
}

export { updateSubtitlesCache };
