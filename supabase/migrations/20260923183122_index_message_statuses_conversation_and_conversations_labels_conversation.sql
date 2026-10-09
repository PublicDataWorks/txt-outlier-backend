-- Reconstructed 2026-09-27 from supabase_migrations.schema_migrations on the production project
-- (pshrrdazlftosdtoevpf). This migration was applied directly to production on 2026-09-23 but the
-- file was never committed, leaving prod ahead of the repo. The SQL below is the verbatim recorded
-- statement; both indexes were confirmed present in prod and their definitions match.
--
-- Note for any fresh environment: these are plain (non-CONCURRENT) CREATE INDEX statements, because
-- in production the indexes were built CONCURRENTLY by hand first and this migration only recorded
-- that fact. Running this file against a large existing table takes a SHARE lock for the duration
-- of the build: reads continue, but writes wait until the index is built.

-- Built CONCURRENTLY beforehand; recorded here so the migration history matches.
CREATE INDEX IF NOT EXISTS idx_message_statuses_missive_conversation_id ON public.message_statuses (missive_conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_labels_conversation_id ON public.conversations_labels (conversation_id);
