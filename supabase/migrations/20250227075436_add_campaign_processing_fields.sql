-- Add processed flag to campaigns table
ALTER TABLE campaigns
ADD COLUMN processed boolean DEFAULT false NOT NULL;

-- Create campaign_messages table for tracking message deliveries
CREATE TABLE campaign_messages (
  id serial PRIMARY KEY NOT NULL,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_phone_number text NOT NULL REFERENCES authors(phone_number) ON DELETE CASCADE,
  message_type text NOT NULL CHECK (message_type IN ('first', 'second')),
  status text NOT NULL DEFAULT 'queued',
  missive_id uuid,
  missive_conversation_id uuid,
  twilio_id text,
  twilio_sent_status text,
  twilio_sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT unique_campaign_recipient_message_type UNIQUE(campaign_id, recipient_phone_number, message_type)
);

-- Add trigger to update updated_at
CREATE TRIGGER handle_updated_at_campaign_messages
  BEFORE UPDATE ON campaign_messages
  FOR EACH ROW
  EXECUTE PROCEDURE moddatetime(updated_at);

-- Create indexes for performance
CREATE INDEX idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX idx_campaign_messages_recipient_phone_number ON campaign_messages(recipient_phone_number);
CREATE INDEX idx_campaign_messages_status ON campaign_messages(status);

-- Create campaign messages queues
SELECT pgmq.create('campaign_messages');
SELECT pgmq.create('campaign_second_messages');

-- Create function to trigger campaign processing
CREATE OR REPLACE FUNCTION trigger_campaign_processor()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    PERFORM net.http_post(
        url:=edge_url || 'campaigns-processor/',
        headers:=jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_key
        ),
        body:=jsonb_build_object('action', 'check-due')
    );
END;
$$ LANGUAGE plpgsql;

-- Schedule regular checks for due campaigns
SELECT cron.schedule(
  'check-due-campaigns-every-minute',
  '* * * * *',
  'SELECT trigger_campaign_processor();'
);
