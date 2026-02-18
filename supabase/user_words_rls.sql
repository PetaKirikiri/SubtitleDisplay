-- RLS policies for user_words table
-- Run this in Supabase Dashboard → SQL Editor
-- Ensures users can only access their own rows (user_id = auth.uid())
--
-- If policies already exist and conflict, drop them first:
-- DROP POLICY IF EXISTS "Users can read own user_words" ON user_words;
-- DROP POLICY IF EXISTS "Users can insert own user_words" ON user_words;
-- DROP POLICY IF EXISTS "Users can update own user_words" ON user_words;
-- DROP POLICY IF EXISTS "Users can delete own user_words" ON user_words;

-- Enable RLS (if not already)
ALTER TABLE user_words ENABLE ROW LEVEL SECURITY;

-- Allow users to SELECT their own rows
CREATE POLICY "Users can read own user_words"
  ON user_words FOR SELECT
  USING (auth.uid()::text = user_id);

-- Allow users to INSERT their own rows (user_id must match auth.uid())
CREATE POLICY "Users can insert own user_words"
  ON user_words FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

-- Allow users to UPDATE their own rows
CREATE POLICY "Users can update own user_words"
  ON user_words FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Allow users to DELETE their own rows
CREATE POLICY "Users can delete own user_words"
  ON user_words FOR DELETE
  USING (auth.uid()::text = user_id);
