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
  meaning_id: bigintCoerce.optional(), // Optional - allows tagless tokens
}).strict();

export type TokenObject = z.infer<typeof tokenObjectSchema>;

/**
 * TokensTh schema - accepts both old format (string[]) and new format (TokenObject[])
 * Normalizes to new format during validation
 * 
 * Accepted formats:
 * - Old format: { tokens: ["เนื้อ", "เรื่อง", "ต้น"] } - array of strings
 * - New format: { tokens: [{ t: "เนื้อ", meaning_id: 123 }, { t: "เรื่อง" }, ...] } - array of TokenObjects
 * 
 * Normalization:
 * - Old format strings are converted to tagless TokenObjects: "word" -> { t: "word" }
 * - New format TokenObjects are preserved as-is
 * - Mixed arrays (both formats) are normalized to all TokenObjects
 * 
 * The system gracefully handles:
 * - Arrays with all tagged tokens
 * - Arrays with all tagless tokens  
 * - Arrays mixing tagged and tagless tokens (partial coverage)
 * 
 * Backwards compatibility: Old data loads fine and normalizes automatically on first access.
 */
const tokensThSchema = z.union([
  // Old format: { tokens: string[] }
  z.object({
    tokens: z.array(z.string().min(1)),
  }),
  // New format: { tokens: TokenObject[] }
  z.object({
    tokens: z.array(tokenObjectSchema),
  }),
]).transform((data) => {
  // Normalize to new format - convert strings to tagless TokenObjects
  const normalizedTokens = data.tokens.map((token) => {
    if (typeof token === 'string') {
      return { t: token }; // Old format: create tagless TokenObject
    }
    return token as TokenObject; // New format: preserve as-is
  });
  return { tokens: normalizedTokens };
});

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
  id: z.string()
    .min(1, 'Subtitle id is required')
    .refine(val => val.trim().length > 0, 'Subtitle id cannot be only whitespace'),
  thai: z.string()
    .min(1, 'thai is required')
    .refine(val => val.trim().length > 0, 'thai cannot be empty or only whitespace'),
  start_sec_th: numberCoerce
    .refine(val => val >= 0, 'start_sec_th cannot be negative')
    .refine(val => val < 86400, 'start_sec_th seems unreasonably large (over 24 hours)'),
  end_sec_th: numberCoerce
    .refine(val => val >= 0, 'end_sec_th cannot be negative')
    .refine(val => val < 86400, 'end_sec_th seems unreasonably large (over 24 hours)'),
  tokens_th: tokensThSchema.optional(), // Optional - Thai tokens (normalized to new format)
}).refine(
  (data) => {
    return data.end_sec_th > data.start_sec_th;
  },
  {
    message: 'end_sec_th must be greater than start_sec_th',
    path: ['end_sec_th'],
  }
);

export type SubtitleTh = z.infer<typeof subtitleThSchema>;
