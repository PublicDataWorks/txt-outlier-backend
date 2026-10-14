-- Index for twilio_messages.conversation_id, in its own migration so that the lock taken by the column and
-- foreign key migration (20261007190000) is released before the table is scanned.
--
-- Partial, so it is empty when created and only ever holds rows that have a conversation. Creating it still scans
-- the whole table once, under a lock that blocks writes. CONCURRENTLY avoids that lock but is not allowed inside a
-- transaction, and tooling may wrap a migration in one, so it is not used here. On production, build it beforehand
-- with CONCURRENTLY (see step 1 in supabase/scripts/backfill_twilio_messages_conversation_id.sql) and this
-- statement becomes a no-op; the guard below refuses to build it any other way on a large table.
--
-- IF NOT EXISTS only compares names. An invalid index left behind by a failed CONCURRENTLY build would be kept, so
-- check pg_index.indisvalid before relying on it.
SET lock_timeout = '5s';

-- lock_timeout only limits the wait for the lock, not the scan that follows it, so an accidental plain build on the
-- production table would block every SMS write for the whole scan. Refuse instead. A fresh database (CI, local) has
-- an empty table and passes. An invalid index from a failed CONCURRENTLY build is refused too, because it would
-- otherwise be kept. The build is inside this block so that, when the index already exists, nothing takes a lock on
-- twilio_messages here (CREATE INDEX IF NOT EXISTS would lock the table before checking the name).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_twilio_messages_conversation_id'
      AND c.relnamespace = 'public'::regnamespace
      AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_twilio_messages_conversation_id exists but is invalid: DROP INDEX CONCURRENTLY it and rebuild it (step 1 in supabase/scripts/backfill_twilio_messages_conversation_id.sql)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'idx_twilio_messages_conversation_id'
      AND relnamespace = 'public'::regnamespace
  ) THEN
    IF (SELECT reltuples FROM pg_class WHERE oid = 'public.twilio_messages'::regclass) > 100000 THEN
      RAISE EXCEPTION 'build idx_twilio_messages_conversation_id with CREATE INDEX CONCURRENTLY first (step 1 in supabase/scripts/backfill_twilio_messages_conversation_id.sql); a plain build here blocks all SMS writes';
    END IF;
    CREATE INDEX idx_twilio_messages_conversation_id
      ON public.twilio_messages (conversation_id, delivered_at)
      WHERE conversation_id IS NOT NULL;
  END IF;
END $$;

RESET lock_timeout;
