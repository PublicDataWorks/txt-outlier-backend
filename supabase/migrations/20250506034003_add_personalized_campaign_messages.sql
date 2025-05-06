-- Create a much simpler personalized_campaign_messages table
CREATE TABLE personalized_campaign_messages (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a trigger function that immediately sends messages to the queue
CREATE OR REPLACE FUNCTION process_personalized_messages()
RETURNS TRIGGER AS $$
DECLARE
  v_campaign_id INTEGER;
  v_campaign_title TEXT;
  v_message JSON;
BEGIN
  -- Create a unique campaign name based on timestamp
  v_campaign_title := 'One-time Campaign ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
  
  -- Create a campaign record
  INSERT INTO campaigns (
    title,
    first_message,
    run_at,
    delay,
    processed
  ) VALUES (
    v_campaign_title,
    'One-time personalized messages',
    NOW(),  -- Run immediately
    0,      -- No delay for follow-up messages
    TRUE    -- Mark as processed since we handle it differently
  )
  RETURNING id INTO v_campaign_id;
  
  -- For each new message, send it directly to the queue
  FOR v_message IN 
    SELECT jsonb_build_object(
      'recipient_phone_number', NEW.phone_number,
      'campaign_id', v_campaign_id,
      'first_message', NEW.message,
      'second_message', NULL,
      'title', v_campaign_title,
      'delay', 0,
      'created_at', EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  LOOP
    -- Send message to the broadcast_first_messages queue
    PERFORM pgmq.send('broadcast_first_messages', v_message);
  END LOOP;
  
  -- Delete the row after sending to queue
  DELETE FROM personalized_campaign_messages WHERE id = NEW.id;
  
  RETURN NULL; -- Trigger is AFTER, so return value is ignored
END;
$$ LANGUAGE plpgsql;

-- Create the trigger to process messages immediately upon insertion
CREATE TRIGGER trigger_process_personalized_messages
AFTER INSERT ON personalized_campaign_messages
FOR EACH ROW
EXECUTE FUNCTION process_personalized_messages();