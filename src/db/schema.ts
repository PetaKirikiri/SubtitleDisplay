import { pgTable, text, numeric, bigint, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Drizzle Schema Definitions
 * 
 * 📋 SOURCE OF TRUTH: Zod schemas in src/schemas/
 * 
 * These Drizzle schemas match the Zod schemas exactly (same column names).
 * Drizzle schemas are used for:
 * - Type definitions and type safety
 * - Relation definitions (shapes)
 * - Migration generation
 * 
 * ⚠️ QUERY EXECUTION: Queries are executed via Supabase client (browser-compatible).
 * Drizzle schemas inform types but don't execute queries directly.
 * 
 * Architecture: TanStack Query → Supabase Client Functions → Supabase REST API → PostgreSQL
 *                                    ↑
 *                            Drizzle Schema (type definitions & relations)
 */

/**
 * Episodes Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/episodeSchema.ts
 * 
 * Maps to Zod schema (episodeSchema.ts) - column names match exactly:
 * - id → episodeSchema.id (bigint, required)
 * - media_id → episodeSchema.media_id (string, required)
 * - show_title → episodeSchema.show_title (string, optional)
 * - season_number → episodeSchema.season_number (number, optional)
 * - episode_number → episodeSchema.episode_number (number, optional)
 * - episode_title → episodeSchema.episode_title (string, optional)
 */
export const episodes = pgTable('episodes', {
  id: bigint('id', { mode: 'number' }).primaryKey(), // Maps to episodeSchema.id (bigint)
  media_id: text('media_id').notNull(), // Maps to episodeSchema.media_id (required)
  show_title: text('show_title'), // Maps to episodeSchema.show_title (optional)
  season_number: numeric('season_number'), // Maps to episodeSchema.season_number (optional)
  episode_number: numeric('episode_number'), // Maps to episodeSchema.episode_number (optional)
  episode_title: text('episode_title'), // Maps to episodeSchema.episode_title (optional)
});

/**
 * Subtitle Thai Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/subtitleThSchema.ts
 * 
 * Maps to Zod schema (subtitleThSchema.ts) - column names match exactly:
 * - id → subtitleThSchema.id (string, required)
 * - thai → subtitleThSchema.thai (string, required)
 * - start_sec_th → subtitleThSchema.start_sec_th (number, required)
 * - end_sec_th → subtitleThSchema.end_sec_th (number, required)
 * - tokens_th → subtitleThSchema.tokens_th (jsonb, optional)
 * 
 * Note: tokens_th contains embedded meaning_id references (not direct FKs).
 * tokens_th format: { tokens: [{ t: string, meaning_id?: number }, ...] }
 */
export const subtitlesTh = pgTable('subtitles_th', {
  id: text('id').primaryKey(), // Maps to subtitleThSchema.id (required)
  thai: text('thai').notNull(), // Maps to subtitleThSchema.thai (required)
  start_sec_th: numeric('start_sec_th').notNull(), // Maps to subtitleThSchema.start_sec_th (required)
  end_sec_th: numeric('end_sec_th').notNull(), // Maps to subtitleThSchema.end_sec_th (required)
  tokens_th: jsonb('tokens_th'), // Maps to subtitleThSchema.tokens_th (optional, JSONB)
});

/**
 * Words Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/wordThSchema.ts
 * 
 * Maps to Zod schema (wordThSchema.ts) - column names match exactly:
 * - word_th → wordThSchema.word_th (string, required, primary key)
 * - g2p → wordThSchema.g2p (string, optional)
 * - phonetic_en → wordThSchema.phonetic_en (string, optional)
 */
export const wordsTh = pgTable('words_th', {
  word_th: text('word_th').primaryKey(), // Maps to wordThSchema.word_th (required, PK)
  g2p: text('g2p'), // Maps to wordThSchema.g2p (optional)
  phonetic_en: text('phonetic_en'), // Maps to wordThSchema.phonetic_en (optional)
});

/**
 * Meanings Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/meaningThSchema.ts
 * 
 * Maps to Zod schema (meaningThSchema.ts) - column names match exactly:
 * - id → meaningThSchema.id (bigint, required, primary key)
 * - definition_th → meaningThSchema.definition_th (text, required)
 * - definition_eng → meaningThSchema.definition_eng (text, required)
 * - pos_eng → meaningThSchema.pos_eng (text, required)
 * - pos_th → meaningThSchema.pos_th (text, required)
 * - word_th_id → meaningThSchema.word_th_id (text, optional, FK to words_th.word_th)
 * - source → meaningThSchema.source (text, optional)
 * - label_eng → meaningThSchema.label_eng (text, optional)
 * - created_at → meaningThSchema.created_at (timestamp, optional)
 */
export const meaningsTh = pgTable('meanings_th', {
  id: bigint('id', { mode: 'number' }).primaryKey(), // Maps to meaningThSchema.id (bigint)
  definition_th: text('definition_th').notNull(), // Maps to meaningThSchema.definition_th (required)
  word_th_id: text('word_th_id').references(() => wordsTh.word_th, { onDelete: 'cascade' }), // Maps to meaningThSchema.word_th_id (optional, FK to words_th.word_th)
  source: text('source'), // Maps to meaningThSchema.source (optional)
  label_eng: text('label_eng'), // Maps to meaningThSchema.label_eng (optional)
  created_at: timestamp('created_at'), // Maps to meaningThSchema.created_at (optional)
  // V2 fields (optional in database for backward compatibility, but required by Zod schema)
  pos_th: text('pos_th'), // Maps to meaningThSchema.pos_th (required by Zod, nullable in DB)
  pos_eng: text('pos_eng'), // Maps to meaningThSchema.pos_eng (required by Zod, nullable in DB)
  definition_eng: text('definition_eng'), // Maps to meaningThSchema.definition_eng (required by Zod, nullable in DB)
});

// Relations (shapes)
// These define relationships for type inference and documentation
// Actual joins/queries use Supabase client, not Drizzle query builder

/**
 * Words Relations
 * One word can have many meanings (senses)
 */
export const wordsThRelations = relations(wordsTh, ({ many }) => ({
  meanings: many(meaningsTh), // words_th → meanings_th (via word_th_id)
}));

/**
 * Meanings Relations
 * Each meaning belongs to one word
 */
export const meaningsThRelations = relations(meaningsTh, ({ one }) => ({
  word: one(wordsTh, {
    fields: [meaningsTh.word_th_id],
    references: [wordsTh.word_th],
  }),
}));

/**
 * User Words Table
 *
 * SOURCE OF TRUTH: src/schemas/userWordsSchema.ts
 *
 * Composite primary key: (user_id, word_id)
 * Columns: user_id (uuid), word_id (text), status (text), created_at (timestamp)
 */
export const userWords = pgTable(
  'user_words',
  {
    user_id: text('user_id').notNull(),
    word_id: text('word_id').notNull(),
    status: text('status').notNull(),
    created_at: timestamp('created_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.user_id, table.word_id] }),
  })
);
