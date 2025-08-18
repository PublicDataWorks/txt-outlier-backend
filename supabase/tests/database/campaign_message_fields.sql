BEGIN;

SELECT plan(1);

-- Helper function to get a message from the queue
CREATE OR REPLACE FUNCTION get_campaign_message(p_campaign_id INTEGER) RETURNS JSONB AS $$
DECLARE
    v_message JSONB;
BEGIN
    SELECT message::jsonb
    INTO v_message
    FROM pgmq.q_broadcast_first_messages
    WHERE message::jsonb->>'campaign_id' = p_campaign_id::TEXT
    LIMIT 1;

    RETURN v_message;
END;
$$ LANGUAGE plpgsql;

-- Clean up any temporary tables that might exist from previous runs
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Truncate all test-related tables for clean state
TRUNCATE pgmq.q_broadcast_first_messages;
TRUNCATE campaigns CASCADE;
TRUNCATE conversations CASCADE;
TRUNCATE authors CASCADE;
TRUNCATE labels CASCADE;

-- Set up test data for all tests
INSERT INTO labels (id, name)
VALUES ('ffffffff-1111-2222-3333-444444444444', 'Message Field Test Label');

INSERT INTO authors (phone_number, unsubscribed, exclude)
VALUES ('+66661111111', FALSE, FALSE);

INSERT INTO conversations (id, web_url, app_url, created_at)
VALUES ('deadbeef-5555-6666-7777-888888888888', 'https://test.com', 'https://test.com', NOW());

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('deadbeef-5555-6666-7777-888888888888', 'ffffffff-1111-2222-3333-444444444444', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number, created_at)
VALUES ('deadbeef-5555-6666-7777-888888888888', '+66661111111', NOW());

-- Create a campaign with all fields populated
INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay, label_ids)
VALUES (
    30001,
    'Message Field Test Campaign',
    'First message for field test',
    'Second message for field test',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', 'ffffffff-1111-2222-3333-444444444444'),
        'excluded', jsonb_build_array(
            jsonb_build_object('id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'since', 1234567890)
        )
    ),
    450,
    ARRAY['field-label-1', 'field-label-2', 'field-label-3']
);

SELECT queue_campaign_messages(30001);

-- Test 1: Verify all required fields are present and have correct values
SELECT ok(
    (SELECT
        message->>'recipient_phone_number' = '+66661111111' AND
        (message->>'campaign_id')::INTEGER = 30001 AND
        message->>'first_message' = 'First message for field test' AND
        message->>'second_message' = 'Second message for field test' AND
        message->>'title' = 'Message Field Test Campaign' AND
        (message->>'delay')::INTEGER = 450 AND
        jsonb_array_length(message->'label_ids') = 3 AND
        message->'campaign_segments'->>'included' = '{"id": "ffffffff-1111-2222-3333-444444444444"}' AND
        message->'campaign_segments'->'excluded'->0->>'id' = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' AND
        (message->'campaign_segments'->'excluded'->0->>'since')::BIGINT = 1234567890 AND
        message->>'conversation_id' = 'deadbeef-5555-6666-7777-888888888888' AND
        message ? 'created_at'
     FROM (SELECT get_campaign_message(30001) AS message) t),
    'All required fields are present with correct values in queued campaign message'
);

DROP TABLE IF EXISTS campaign_recipients_temp;

SELECT * FROM finish();
ROLLBACK;
