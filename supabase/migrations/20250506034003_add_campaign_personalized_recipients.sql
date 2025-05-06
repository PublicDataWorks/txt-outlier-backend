-- Create a table for personalized campaign messages
CREATE TABLE campaign_personalized_recipients (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a trigger function that processes all new records at once
CREATE OR REPLACE FUNCTION process_campaign_personalized_recipient_batch()
RETURNS TRIGGER AS $$
DECLARE
  v_campaign_id INTEGER;
  v_campaign_title TEXT;
BEGIN
  -- Create a unique campaign name based on timestamp
  v_campaign_title := 'Personalized Campaign';

  -- Create a single campaign record for all messages in this batch
  INSERT INTO campaigns (
    title,
    first_message,
    run_at,
    processed,
    recipient_count
  ) VALUES (
    v_campaign_title,
    'Personalized campaign',
    NOW() - interval '1 minute',  -- Set to 1 minute in the past for safety
    TRUE,   -- Mark as processed since we handle it differently
    (SELECT COUNT(*) FROM new_rows)
  )
  RETURNING id INTO v_campaign_id;

  -- Queue all the new messages from this batch
  PERFORM pgmq.send_batch(
    'broadcast_first_messages',
    ARRAY(
      SELECT jsonb_build_object(
        'recipient_phone_number', CASE
          WHEN LEFT(phone_number, 1) = '+' THEN phone_number
          ELSE '+' || phone_number
        END,
        'campaign_id', v_campaign_id,
        'first_message', message,
        'second_message', NULL,
        'title', v_campaign_title,
        'delay', 600,
        'created_at', EXTRACT(EPOCH FROM NOW())::INTEGER
      )
      FROM new_rows
    )
  );

  -- Delete all rows that were just processed
  DELETE FROM campaign_personalized_recipients
  WHERE id IN (SELECT id FROM new_rows);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a statement-level trigger
CREATE TRIGGER trigger_process_campaign_personalized_recipient_batch
AFTER INSERT ON campaign_personalized_recipients
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION process_campaign_personalized_recipient_batch();
