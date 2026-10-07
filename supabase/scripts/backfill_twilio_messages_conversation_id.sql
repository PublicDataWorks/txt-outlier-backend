-- Backfill twilio_messages.conversation_id from the raw webhook payloads kept in invoke_history.
-- Operators run this by hand, in batches. It is NOT a migration and nothing runs it automatically.
--
-- Why this works: every message webhook is stored in invoke_history with the message id at
-- request_body->'message'->>'id' and the conversation in invoke_history.conversation_id (equal to
-- request_body->'conversation'->>'id'; checked on samples spread across the whole table). twilio_messages.id is
-- that same Missive message id.
--
-- Coverage (measured read-only on 2026-10-07): invoke_history starts 2024-06-27, twilio_messages starts
-- 2024-03-25, so only about 2.3k of 2.43M messages (0.1%) predate it and cannot be backfilled. In every sampled
-- invoke_history range, 100% of rows carrying a message id matched a twilio_messages row. Expect a small
-- remainder to stay NULL; the view and any reader must treat NULL as "unattributed".
--
-- Why it walks invoke_history by id rather than joining from twilio_messages: invoke_history is ~10 GB (mostly
-- TOASTed jsonb) and has no index on the message id, so a join from twilio_messages would scan it once per
-- message. Walking its primary key in id ranges reads each payload once and updates twilio_messages by primary key.
--
-- Safe to re-run: only rows with conversation_id IS NULL are touched, so repeating a batch changes nothing. Rows
-- are only set when the conversation still exists, so the foreign key never rejects a batch. If a message was
-- delivered more than once, the most recent webhook (highest invoke_history.id) wins.
--
-- ORDER OF OPERATIONS
--   1. Deploy the migration 20261007190000_add_conversation_id_to_twilio_messages.sql and the edge function
--      change together. New messages get a conversation_id from then on. (Optional, recommended on production:
--      build the index first with
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_conversation_id
--          ON public.twilio_messages (conversation_id, delivered_at) WHERE conversation_id IS NOT NULL;
--      so the migration's CREATE INDEX IF NOT EXISTS is a no-op and takes no write lock.)
--   2. Find the id range: SELECT min(id), max(id) FROM invoke_history;   (3575 .. ~3.03M on 2026-10-07)
--   3. Run this file once per batch, advancing from_id by batch_size each time, until from_id passes max(id).
--      Example driver (psql connection string in $DATABASE_URL):
--
--        from=0; max=3100000; size=20000
--        while [ "$from" -le "$max" ]; do
--          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v from_id="$from" -v batch_size="$size" \
--            -f supabase/scripts/backfill_twilio_messages_conversation_id.sql
--          from=$((from + size))
--          sleep 1
--        done
--
--      Start with one batch and check the UPDATE count and timing before looping. Lower batch_size if a batch
--      takes more than a few seconds. Run it outside peak hours; each batch is its own short transaction.
--   4. Re-run step 3 over the full range once more if you want to catch rows that arrived during the run
--      (it is idempotent), then run the check below.
--   5. Validate the foreign key (cheap lock, scans the table once):
--        ALTER TABLE public.twilio_messages VALIDATE CONSTRAINT twilio_messages_conversation_id_fkey;
--
-- CHECK (read-only; scans twilio_messages once, so run it off-peak)
--   SELECT count(*) FILTER (WHERE conversation_id IS NULL) AS unattributed,
--          count(*) FILTER (WHERE conversation_id IS NULL AND created_at >= '2024-06-27') AS unattributed_in_window,
--          count(*) AS total
--   FROM public.twilio_messages;

SET statement_timeout = '120s';

WITH payloads AS (
  SELECT
    ih.id,
    ih.conversation_id,
    -- Guard the cast: a malformed id yields NULL and is skipped instead of aborting the whole batch.
    CASE
      WHEN ih.request_body->'message'->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (ih.request_body->'message'->>'id')::uuid
    END AS message_id
  FROM public.invoke_history ih
  WHERE ih.id >= :from_id
    AND ih.id < :from_id + :batch_size
    AND ih.conversation_id IS NOT NULL
    AND ih.request_body ? 'message'
),
latest AS (
  SELECT DISTINCT ON (message_id) message_id, conversation_id
  FROM payloads
  WHERE message_id IS NOT NULL
  ORDER BY message_id, id DESC
)
UPDATE public.twilio_messages tm
SET conversation_id = latest.conversation_id
FROM latest
WHERE tm.id = latest.message_id
  AND tm.conversation_id IS NULL
  AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = latest.conversation_id);
