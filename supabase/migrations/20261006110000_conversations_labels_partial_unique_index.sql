-- Make idx_unique_active_conversation_label a partial unique index on active rows, as it already is in
-- production. The baseline migration (0000) created it as a full unique index, so databases built from
-- the repo disagreed with production: a label that was removed (is_archived = true) and then re-added
-- conflicted with its own archived row.
--
-- user-actions archives links instead of deleting them, and re-adds a label by inserting a new active
-- row. That only works when archived rows are outside the unique index.
--
-- This is a no-op wherever the index is already partial, which includes production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'conversations_labels'
      AND indexname = 'idx_unique_active_conversation_label'
      AND indexdef LIKE '%WHERE%'
  ) THEN
    DROP INDEX IF EXISTS public.idx_unique_active_conversation_label;
    CREATE UNIQUE INDEX idx_unique_active_conversation_label
      ON public.conversations_labels (conversation_id, label_id)
      WHERE (is_archived = false);
  END IF;
END
$$;
