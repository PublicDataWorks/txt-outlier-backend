-- handleFailedDeliveries closes message_statuses rows by missive_conversation_id, and user-actions archives
-- conversations_labels rows by conversation_id. Neither column had a usable index, so each of those updates
-- read the whole table (about 1 GB for message_statuses). The partial idx_unique_active_conversation_label
-- index only covers is_archived = false, which the conversations_labels update does not filter on.
--
-- In production these were built with CREATE INDEX CONCURRENTLY; IF NOT EXISTS keeps this a no-op there.
CREATE INDEX IF NOT EXISTS idx_message_statuses_missive_conversation_id
  ON public.message_statuses (missive_conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversations_labels_conversation_id
  ON public.conversations_labels (conversation_id);
