import { z } from 'zod';
import { uuidCoerce } from './zodHelpers';

/**
 * User Words Schema - matches user_words table
 * Database table: user_words
 * Primary key: composite (user_id, word_id)
 * Columns: user_id (uuid), word_id (text), status (text), created_at (timestamp)
 *
 * Usage:
 * - Before save: userWordsSchema.parse(data)
 * - On data pull: userWordsSchema.safeParse(dbData)
 */
export const userWordsSchema = z.object({
  user_id: uuidCoerce,
  word_id: z.string().min(1, 'word_id is required'),
  status: z.string(),
  created_at: z.string().datetime().optional(),
});

export type UserWords = z.infer<typeof userWordsSchema>;
