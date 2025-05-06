BEGIN;

-- Create a plan for our tests
SELECT plan(4);

-- Helper function to count messages in the queue for a specific campaign
CREATE OR REPLACE FUNCTION count_queued_messages(p_campaign_id INTEGER) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM pgmq.q_broadcast_first_messages
    WHERE message::jsonb->>'campaign_id' = p_campaign_id::TEXT;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Helper function to check if phone numbers in queue have "+" prefix
CREATE OR REPLACE FUNCTION check_phone_number_format(p_campaign_id INTEGER) RETURNS BOOLEAN AS $$
DECLARE
    v_result BOOLEAN;
BEGIN
    SELECT bool_and(message::jsonb->>'recipient_phone_number' LIKE '+%')
    INTO v_result
    FROM pgmq.q_broadcast_first_messages
    WHERE message::jsonb->>'campaign_id' = p_campaign_id::TEXT;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Clean up any existing test data
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'title' LIKE 'Personalized Campaign%';
DELETE FROM campaigns WHERE title LIKE 'Personalized Campaign%';
DELETE FROM campaign_personalized_recipients;

-- Test 1: Basic test - Insert a single batch of personalized recipients
INSERT INTO campaign_personalized_recipients (phone_number, message)
VALUES
    ('+15551234567', 'Test message with + prefix'),
    ('15552345678', 'Test message without + prefix');

-- Get the campaign ID
WITH latest_campaign AS (
    SELECT id FROM campaigns WHERE title LIKE 'Personalized Campaign%' ORDER BY id DESC LIMIT 1
)
SELECT is(
    (SELECT recipient_count::INTEGER FROM campaigns WHERE id = (SELECT id FROM latest_campaign)),
    2,
    'Campaign recipient_count is correctly set to 2'
);

-- Test 2: Verify all messages were queued
WITH latest_campaign AS (
    SELECT id FROM campaigns WHERE title LIKE 'Personalized Campaign%' ORDER BY id DESC LIMIT 1
)
SELECT is(
    count_queued_messages((SELECT id FROM latest_campaign)),
    2,
    'All messages were correctly queued for processing'
);

-- Test 3: Verify phone number formatting (adding "+" prefix when needed)
WITH latest_campaign AS (
    SELECT id FROM campaigns WHERE title LIKE 'Personalized Campaign%' ORDER BY id DESC LIMIT 1
)
SELECT is(
    check_phone_number_format((SELECT id FROM latest_campaign)),
    TRUE,
    'All phone numbers in the queue have the "+" prefix'
);

-- Test 4: Verify that processed records are deleted
SELECT is(
    (SELECT COUNT(*)::INTEGER FROM campaign_personalized_recipients),
    0,
    'Processed records are deleted after queuing'
);

-- Clean up
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'title' LIKE 'Personalized Campaign%';
DELETE FROM campaigns WHERE title LIKE 'Personalized Campaign%';

-- Finish the test
SELECT * FROM finish();

ROLLBACK;
