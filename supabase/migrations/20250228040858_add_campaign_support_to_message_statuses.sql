ALTER TABLE broadcast_sent_message_status
RENAME TO message_statuses;
-- Add campaign_id column
ALTER TABLE message_statuses
ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE;

-- Make broadcast_id nullable
ALTER TABLE message_statuses
ALTER COLUMN broadcast_id DROP NOT NULL;

-- Make audience_segment_id nullable since campaigns don't use it
ALTER TABLE message_statuses
ALTER COLUMN audience_segment_id DROP NOT NULL;

-- Rename the unique constraint to match the new table name
ALTER TABLE message_statuses
RENAME CONSTRAINT broadcast_sent_message_status_missive_id_key TO message_statuses_missive_id_key;

ALTER INDEX broadcast_sent_message_status_audience_segment_id_idx RENAME TO message_statuses_audience_segment_id_idx;
ALTER INDEX broadcast_sent_message_status_broadcast_id_idx RENAME TO message_statuses_broadcast_id_idx;
ALTER INDEX broadcast_sent_message_status_recipient_phone_number_idx RENAME TO message_statuses_recipient_phone_number_idx;
ALTER INDEX broadcast_sent_message_status_pkey RENAME TO message_statuses_pkey;

-- Add an index on campaign_id for better query performance
CREATE INDEX idx_message_statuses_campaign_id ON message_statuses(campaign_id);

-- Update sequence name if needed
ALTER SEQUENCE broadcast_sent_message_status_id_seq RENAME TO message_statuses_id_seq;
