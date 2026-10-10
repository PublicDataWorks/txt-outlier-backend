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
-- delivered more than once, the most recent webhook (highest invoke_history.id) wins within a batch; across
-- batches the first batch to reach the message wins, because only NULL rows are written.
--
-- ORDER OF OPERATIONS
--   1. Recommended on production: prepare the column and the index by hand, so the migrations do almost nothing.
--        ALTER TABLE public.twilio_messages ADD COLUMN IF NOT EXISTS conversation_id uuid;   -- momentary lock
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_conversation_id
--          ON public.twilio_messages (conversation_id, delivered_at) WHERE conversation_id IS NOT NULL;
--      CONCURRENTLY cannot run inside a transaction, so send these as separate statements from psql, not as one
--      pasted multi-statement query. Then confirm the index is valid; IF NOT EXISTS would keep an invalid one
--      left by a failed build, and it still costs writes:
--        SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_twilio_messages_conversation_id'::regclass;
--      If it is false, run DROP INDEX CONCURRENTLY public.idx_twilio_messages_conversation_id; and build it again.
--   2. Apply the migrations 20261007190000 and 20261007190100 FIRST, then deploy the user-actions edge function.
--      If the function ships first, every message insert fails on the missing column; the webhook swallows the
--      error and still returns 200, so the SMS is lost. New messages get a conversation_id from then on.
--   3. Find the id range: SELECT min(id), max(id) FROM invoke_history;   (3575 .. ~3.03M on 2026-10-07)
--   4. Run this file once per batch, advancing from_id by batch_size each time, until from_id passes max(id).
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
--      Every UPDATE is non-HOT now that conversation_id is indexed, so the run rewrites about 2.4M rows and their
--      index entries. Watch WAL volume and replication lag while it runs.
--   5. Re-run step 4 over the full range once more if you want to catch rows that arrived during the run
--      (it is idempotent), then run the check below.
--   6. Reclaim the dead rows, then validate the foreign key (cheap lock, scans the table once):
--        VACUUM (ANALYZE) public.twilio_messages;
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
