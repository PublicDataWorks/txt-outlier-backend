-- filename: migrations/20250310_add_file_based_campaigns.sql

ALTER TABLE campaigns
  ALTER COLUMN segments DROP NOT NULL,
  ADD COLUMN file_url TEXT;

-- Create file_recipients table for storing phone numbers from uploaded files
CREATE TABLE file_recipients (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_file_recipients_campaign_id ON file_recipients(campaign_id);

CREATE UNIQUE INDEX unique_phone_per_campaign ON file_recipients(phone_number, campaign_id);

