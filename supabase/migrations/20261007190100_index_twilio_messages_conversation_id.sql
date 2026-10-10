-- Index for twilio_messages.conversation_id, in its own migration so that the lock taken by the column and
-- foreign key migration (20261007190000) is released before the table is scanned.
--
-- Partial, so it is empty when created and only ever holds rows that have a conversation. Creating it still scans
-- the whole table once, under a lock that blocks writes, and a migration runs in a transaction, where CREATE INDEX
-- CONCURRENTLY is not allowed. On production, build it beforehand with CONCURRENTLY (see step 1 in
-- supabase/scripts/backfill_twilio_messages_conversation_id.sql) and this statement becomes a no-op.
--
-- IF NOT EXISTS only compares names. An invalid index left behind by a failed CONCURRENTLY build would be kept, so
-- check pg_index.indisvalid before relying on it.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_twilio_messages_conversation_id
  ON public.twilio_messages (conversation_id, delivered_at)
  WHERE conversation_id IS NOT NULL;

RESET lock_timeout;
