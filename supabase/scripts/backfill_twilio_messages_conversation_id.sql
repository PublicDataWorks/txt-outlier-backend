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
--        SET lock_timeout = '3s';
--        ALTER TABLE public.twilio_messages ADD COLUMN IF NOT EXISTS conversation_id uuid;   -- momentary lock
--      Set lock_timeout first. ALTER TABLE queues for ACCESS EXCLUSIVE before it checks IF NOT EXISTS, and a long
--      analyst query or an autovacuum on the table would otherwise make every SMS insert queue behind the ALTER.
--      If it times out, run it again a minute later.
--        RESET lock_timeout;   -- CONCURRENTLY waits on older transactions, and lock_timeout would abort it after the scans
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_conversation_id
--          ON public.twilio_messages (conversation_id, delivered_at) WHERE conversation_id IS NOT NULL;
--      CONCURRENTLY cannot run inside a transaction, so send these as separate statements from psql, not as one
--      pasted multi-statement query. Then confirm the index is valid; IF NOT EXISTS would keep an invalid one
--      left by a failed build, and it still costs writes:
--        SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_twilio_messages_conversation_id'::regclass;
--      If it is false, run DROP INDEX CONCURRENTLY public.idx_twilio_messages_conversation_id; and build it again.
--   2. Apply the migrations 20261007190000 and 20261007190100 FIRST, then deploy the user-actions edge function.
--      If the function ships before the column exists (step 1 adds it), every message insert fails; the webhook swallows
--      the error and still returns 200, so the SMS is lost. New messages get a conversation_id from then on. Messages
--      stored between the column existing and the new function going live have NULL; step 5 picks them up.
--   3. Find the id range: SELECT min(id), max(id) FROM invoke_history;   (3575 .. ~3.03M on 2026-10-07)
--   4. Run this file once per batch, advancing from_id by batch_size each time, until from_id passes max(id).
--      Example driver (psql connection string in $DATABASE_URL):
--
--        from=0; size=5000
--        max=$(psql "$DATABASE_URL" -Atc 'select max(id) from public.invoke_history')   # not a fixed number: it keeps growing
--        while [ "$from" -le "$max" ]; do
--          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v from_id="$from" -v batch_size="$size" \
--            -f supabase/scripts/backfill_twilio_messages_conversation_id.sql || { echo "stopped at from_id=$from"; break; }
--          from=$((from + size))
--          sleep 1
--        done
--
--      Start with one batch and check the UPDATE count and timing before looping. Keep a batch to a few seconds:
--      each updated row's foreign key check holds a lock on its conversation row until the batch commits, and the
--      webhook's conversation upsert needs that row, so a long batch delays the webhook for that conversation. Run it only between 04:00 and 12:00 UTC and never across the Tue/Wed/Thu
--      14:00 UTC broadcasts; each batch is its own short transaction.
--      Every UPDATE is non-HOT now that conversation_id is indexed, so the run rewrites about 2.4M rows and their
--      index entries, which is several GB of WAL. twilio_messages is in the supabase_realtime publication, so each
--      updated row is also a change event for any postgres_changes subscriber (RLS is checked per subscriber).
--      Watch WAL volume, replication slot lag and replication lag while it runs, and stop if a slot falls behind.
--      The sidebar only subscribes to INSERTs on twilio_messages, so it never receives these updates, but Realtime still
--      decodes every one; if it falls behind, the sidebar's new-message flag is what users would notice.
--   5. Re-run step 4 over the full range once more if you want to catch rows that arrived during the run
--      (it is idempotent), then run the check below.
--   6. Reclaim the dead rows, then validate the foreign key (cheap lock, scans the table once):
--        VACUUM (ANALYZE) public.twilio_messages;
--        ALTER TABLE public.twilio_messages VALIDATE CONSTRAINT twilio_messages_conversation_id_fkey;
--
-- ROLLBACK
--   Order matters: the new user-actions inserts conversation_id, so dropping the column while it is deployed makes
--   every message insert fail, and the webhook still returns 200 (the SMS is silently lost).
--   1. Redeploy the previous user-actions version (always safe on its own, before or after the migrations).
--   2. Then, in psql, one statement at a time:
--        SET lock_timeout = '3s';
--        DROP VIEW IF EXISTS public.conversation_staff_activity;
--        BEGIN;
--          LOCK TABLE public.conversations IN SHARE ROW EXCLUSIVE MODE;   -- the webhook's lock order, avoids a deadlock
--          ALTER TABLE public.twilio_messages DROP CONSTRAINT IF EXISTS twilio_messages_conversation_id_fkey;
--          ALTER TABLE public.twilio_messages DROP COLUMN IF EXISTS conversation_id;
--        COMMIT;
--        RESET lock_timeout;
--        DROP INDEX CONCURRENTLY IF EXISTS public.idx_twilio_messages_conversation_id;   -- its own statement
--      (Dropping the column also drops the index, so the last line is only needed if you drop the index alone.)
--   3. supabase migration repair --status reverted 20261007190000 20261007190100
--   After the backfill the column only costs dead rows and index space, so leaving it in place is also safe.
--
-- AFTER THE MIGRATIONS (read-only checks): the view exists and the analyst roles can read it (default privileges grant
--   them SELECT; the migration revokes address-lookup-readonly, anon and authenticated):
--   SELECT has_table_privilege('readonly_outlier','public.conversation_staff_activity','SELECT'),
--          has_table_privilege('anon','public.conversation_staff_activity','SELECT');   -- expect true, false
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
