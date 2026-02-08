import { z } from 'zod';
import { numberCoerce, bigintCoerce } from './zodHelpers';

/**
 * TokenObject schema - represents a token with optional meaning selection
 * 
 * Format: { t: string, meaning_id?: bigint }
 * 
 * - t: Thai word text (required) - the surface form of the token
 * - meaning_id: Selected meaning ID from meanings_th table (optional) - bigint
 * 
 * Tagged vs Tagless:
 * - Tagged token: Has meaning_id set (e.g., { t: "เนื้อ", meaning_id: 123 })
 * - Tagless token: No meaning_id (e.g., { t: "เนื้อ" })
 * 
 * The tokens array can contain a mix of both tagged and tagless elements.
 * This allows partial coverage - workers can tag some tokens and leave others untagged.
 * 
 * Example mixed array:
 * [
 *   { t: "เนื้อ", meaning_id: 123 },  // Tagged - meaning selected
 *   { t: "เรื่อง" },                   // Tagless - no meaning selected yet
 *   { t: "ต้น", meaning_id: 456 }     // Tagged - meaning selected
 * ]
 */
export const tokenObjectSchema = z.object({
  t: z.string().min(1, 'Token text is required'),
  meaning_id: bigintCoerce.optional(), // Optional - allows tagless tokens, must be bigint to match meaning.id type
}).strict();

export type TokenObject = z.infer<typeof tokenObjectSchema>;

/**
 * TokensTh schema - accepts any structure with tokens array
 * Minimal validation - just check it's an object with a tokens array
 * Normalization happens in application code when needed
 */
const tokensThSchema = z.object({
  tokens: z.array(z.any()), // Accept any token format - normalization happens in application code
}).passthrough(); // Allow additional properties

/**
 * Subtitle Thai Schema - matches ACTUAL database column names (snake_case)
 * Database table: subtitles_th
 * Actual columns: id (text), thai (text), start_sec_th (numeric), end_sec_th (numeric), tokens_th (jsonb)
 * 
 * tokens_th (JSONB) format:
 * 
 * Old format (legacy, auto-normalized):
 *   { tokens: ["เนื้อ", "เรื่อง", "ต้น"] }
 * 
 * New format (current, supports meaning selection):
 *   { 
 *     tokens: [
 *       { t: "เนื้อ", meaning_id: 123 },  // Tagged - meaning selected
 *       { t: "เรื่อง" },                   // Tagless - no selection yet
 *       { t: "ต้น", meaning_id: 456 }     // Tagged - meaning selected
 *     ]
 *   }
 * 
 * Key points:
 * - meaning_id is optional - allows tagless tokens (no selection made)
 * - Array can mix tagged and tagless elements (partial coverage is fine)
 * - Old format automatically normalizes to new format on validation
 * - System handles partial coverage gracefully - not all tokens need meaning_id
 * 
 * When a worker selects a meaning for a token, meaning_id is set on that TokenObject.
 * Tokens without meaning_id remain tagless until a selection is made.
 */
export const subtitleThSchema = z.object({
  id: z.string().min(1, 'Subtitle id is required'), // Minimal validation - just check it exists and matches pattern
  thai: z.string().min(1, 'thai is required'), // Minimal validation - just check it exists
  start_sec_th: numberCoerce, // Coerce to number, no additional validation
  end_sec_th: numberCoerce, // Coerce to number, no additional validation
  tokens_th: tokensThSchema.optional(), // Optional - accept any structure
}).passthrough(); // Allow additional properties

export type SubtitleTh = z.infer<typeof subtitleThSchema>;
