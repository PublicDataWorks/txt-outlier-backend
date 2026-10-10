-- Record which Missive conversation each SMS belongs to, and expose per-conversation staff activity.
--
-- twilio_messages used to carry no conversation_id: a message was tied to a conversation only through the phone
-- numbers in conversations_authors, which is ambiguous when one resident has several conversations. The
-- user-actions webhook always knows requestBody.conversation.id when it inserts a message, so it now stores it.
--
-- Cost on the ~2.4M row table: ADD COLUMN of a nullable column without a default is a catalog-only change (no
-- rewrite). The column stays NULL for existing rows; supabase/scripts/backfill_twilio_messages_conversation_id.sql
-- fills it in batches from invoke_history, run manually by an operator.
--
-- The ALTER TABLE and ADD CONSTRAINT below need locks that every inbound SMS also needs: ADD COLUMN takes ACCESS
-- EXCLUSIVE on twilio_messages, and ADD CONSTRAINT takes SHARE ROW EXCLUSIVE on twilio_messages and on conversations.
-- A migration file runs as one transaction, so these locks are held until the file commits. Keep this file free of
-- slow statements; the index is built by the next migration for that reason. If a long query holds a conflicting
-- lock, the waiting ALTER queues every webhook write behind it, so lock_timeout makes the migration fail after 5
-- seconds instead; run it again when the table is quiet.
SET lock_timeout = '5s';

ALTER TABLE public.twilio_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

-- The handler upserts the conversation in the same transaction before inserting the message, so a foreign key is
-- safe for new rows. It is added NOT VALID so the migration does not scan the table while holding a lock: the
-- constraint is enforced for every new or updated row immediately. Validating existing rows is a manual step
-- (step 6 in supabase/scripts/backfill_twilio_messages_conversation_id.sql), run once the backfill has filled
-- them; VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock. SET NULL, not
-- CASCADE, so deleting a conversation never deletes the SMS history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'twilio_messages_conversation_id_fkey'
      AND conrelid = 'public.twilio_messages'::regclass
  ) THEN
    ALTER TABLE public.twilio_messages
      ADD CONSTRAINT twilio_messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- One row per (conversation, staff user) with any recorded work on that conversation.
--
-- replies_sent / first_reply_at / last_reply_at: outbound SMS with a sender_id that are not broadcast sends.
-- Broadcast messages are sent through the Missive API as a staff user too (so they carry a sender_id), but their
-- Missive id is recorded in message_statuses.missive_id, which is how they are excluded. Replies sent by
-- keyword/automation rules have no sender_id and never appear here.
-- Only rows with conversation_id set count; until the backfill has run, older messages are not attributed.
-- comments_count: comments the user left on the conversation.
-- currently_assigned: the user's inbox row for the conversation has assigned = true.
-- A user appears only if they replied, commented, or are currently assigned.
--
-- Each CTE is referenced more than once, which makes Postgres compute it over the whole table before the outer
-- filter applies. NOT MATERIALIZED lets a WHERE conversation_id = ... reach twilio_messages and use
-- idx_twilio_messages_conversation_id.
--
-- security_invoker makes the view obey the RLS policies of the underlying tables. Without it the view runs with its
-- owner's rights, and since public views are exposed through the API, staff names and emails would become readable
-- by the anon key.
CREATE OR REPLACE VIEW public.conversation_staff_activity
WITH (security_invoker = true) AS
WITH replies AS NOT MATERIALIZED (
  SELECT
    tm.conversation_id,
    tm.sender_id AS user_id,
    count(*) AS replies_sent,
    min(tm.delivered_at) AS first_reply_at,
    max(tm.delivered_at) AS last_reply_at
  FROM public.twilio_messages tm
  WHERE tm.conversation_id IS NOT NULL
    AND tm.sender_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.message_statuses ms WHERE ms.missive_id = tm.id)
  GROUP BY tm.conversation_id, tm.sender_id
),
comment_counts AS NOT MATERIALIZED (
  SELECT c.conversation_id, c.user_id, count(*) AS comments_count
  FROM public.comments c
  WHERE c.conversation_id IS NOT NULL
  GROUP BY c.conversation_id, c.user_id
),
assignments AS NOT MATERIALIZED (
  SELECT ca.conversation_id, ca.user_id, bool_or(ca.assigned) AS currently_assigned
  FROM public.conversations_assignees ca
  GROUP BY ca.conversation_id, ca.user_id
),
participants AS NOT MATERIALIZED (
  SELECT conversation_id, user_id FROM replies
  UNION
  SELECT conversation_id, user_id FROM comment_counts
  UNION
  SELECT conversation_id, user_id FROM assignments WHERE currently_assigned
)
SELECT
  p.conversation_id,
  p.user_id,
  u.name AS user_name,
  u.email AS user_email,
  COALESCE(r.replies_sent, 0)::integer AS replies_sent,
  r.first_reply_at,
  r.last_reply_at,
  COALESCE(cc.comments_count, 0)::integer AS comments_count,
  COALESCE(a.currently_assigned, false) AS currently_assigned
FROM participants p
JOIN public.users u ON u.id = p.user_id
LEFT JOIN replies r ON r.conversation_id = p.conversation_id AND r.user_id = p.user_id
LEFT JOIN comment_counts cc ON cc.conversation_id = p.conversation_id AND cc.user_id = p.user_id
LEFT JOIN assignments a ON a.conversation_id = p.conversation_id AND a.user_id = p.user_id;

REVOKE ALL ON public.conversation_staff_activity FROM PUBLIC, anon, authenticated;

-- The default privileges set in 20260928055000 give address-lookup-readonly SELECT on every new relation in public.
-- It has no use for staff names and emails. The role only exists in production, hence the check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'address-lookup-readonly') THEN
    REVOKE ALL ON public.conversation_staff_activity FROM "address-lookup-readonly";
  END IF;
END $$;

RESET lock_timeout;
