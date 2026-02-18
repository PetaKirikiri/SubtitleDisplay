/**
 * TanStack Query utilities for user_words
 * Thin wrapper over central tanstackOperations layer
 */

import { queryClient } from '../lib/queryClient';
import {
  QUERY_KEYS,
  STALE_TIMES,
  readQuery,
  writeOptimistic,
  writeInBackground,
} from '../lib/tanstackOperations';
import {
  fetchUserWords,
  upsertUserWord as supabaseUpsertUserWord,
  deleteUserWord as supabaseDeleteUserWord,
} from '../supabase';
import type { UserWords } from '../schemas/userWordsSchema';

export async function getUserWords(userId: string): Promise<UserWords[]> {
  return readQuery(
    QUERY_KEYS.userWords(userId),
    () => fetchUserWords(userId),
    STALE_TIMES.userWords
  );
}

/**
 * Fetch user words from DB and sync to cache. Use when loading full truth (auth init, after save).
 * Bypasses cache-first to ensure all saved words are loaded.
 */
export async function getUserWordsFromDb(userId: string): Promise<UserWords[]> {
  const words = await fetchUserWords(userId);
  queryClient.setQueryData(QUERY_KEYS.userWords(userId), words);
  return words;
}

export function upsertUserWordOptimistic(row: UserWords): void {
  writeOptimistic(QUERY_KEYS.userWords(row.user_id), (prev) => {
    const current = prev ?? [];
    const filtered = current.filter((r) => r.word_id !== row.word_id);
    return [...filtered, { ...row, created_at: row.created_at ?? new Date().toISOString() }];
  });
}

export function upsertUserWordInBackground(row: UserWords): void {
  writeInBackground(
    QUERY_KEYS.userWords(row.user_id),
    () => supabaseUpsertUserWord(row),
    (result) => {
      writeOptimistic(QUERY_KEYS.userWords(row.user_id), (prev) => {
        if (!prev) return [result];
        return prev.map((r) => (r.word_id === row.word_id ? result : r));
      });
    }
  );
}

export async function upsertUserWord(row: UserWords): Promise<UserWords> {
  upsertUserWordOptimistic(row);
  upsertUserWordInBackground(row);
  return row;
}

/**
 * Delete user_word - local-first: optimistic remove, then persist in background
 */
export function deleteUserWord(userId: string, wordId: string): void {
  writeOptimistic(QUERY_KEYS.userWords(userId), (prev) => {
    if (!prev) return [];
    return prev.filter((r) => r.word_id !== wordId);
  });
  writeInBackground(
    QUERY_KEYS.userWords(userId),
    () => supabaseDeleteUserWord(userId, wordId)
  );
}

/**
 * Invalidate user_words cache (use sparingly; prefer setQueryData)
 */
export async function invalidateUserWords(userId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userWords(userId) });
}
