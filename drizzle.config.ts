import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Drizzle Kit Configuration
 * 
 * Used for schema generation and migrations.
 * Requires DATABASE_URL environment variable for direct Postgres connection.
 * 
 * Note: Runtime queries use Supabase client (browser-compatible).
 * This config is only for migrations and schema introspection.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:[YOUR-PASSWORD]@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres',
  },
} satisfies Config;
