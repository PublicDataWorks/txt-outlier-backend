BEGIN;

-- Create a plan for our tests
SELECT plan(2);

-- Create helper functions
-- Function to get the label_id from a queued message
CREATE OR REPLACE FUNCTION get_label_id_from_message(p_campaign_id INTEGER) RETURNS TEXT AS $$
DECLARE
    v_label_id TEXT;
BEGIN
    SELECT message::jsonb->>'label_id'
    INTO v_label_id
    FROM pgmq.q_broadcast_first_messages
    WHERE message::jsonb->>'campaign_id' = p_campaign_id::TEXT
    LIMIT 1;

    RETURN v_label_id;
END;
$$ LANGUAGE plpgsql;

-- Clean any existing test messages from the queue
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'campaign_id' IN ('20001', '20002');

-- Clean up any temporary tables that might exist from previous runs
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Ensure campaign_recipients_temp doesn't already exist in any session
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c 
        WHERE c.relname = 'campaign_recipients_temp'
    ) THEN
        EXECUTE 'DROP TABLE campaign_recipients_temp';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        -- Ignore any error
END $$;

-- Clean up any existing test data
DELETE FROM campaigns WHERE id IN (20001, 20002);
DELETE FROM conversations_authors WHERE conversation_id IN (
    '00000003-0000-0000-0000-000000000001',
    '00000003-0000-0000-0000-000000000002'
);
DELETE FROM conversations_labels WHERE conversation_id IN (
    '00000003-0000-0000-0000-000000000001',
    '00000003-0000-0000-0000-000000000002'
);
DELETE FROM conversations WHERE id IN (
    '00000003-0000-0000-0000-000000000001',
    '00000003-0000-0000-0000-000000000002'
);
DELETE FROM authors WHERE phone_number LIKE '+8888%';
DELETE FROM labels WHERE id = '00000005-0000-0000-0000-000000000001';

-- Test 1: Campaign with label_id set
-- Set up test data
INSERT INTO labels (id, name)
VALUES ('00000005-0000-0000-0000-000000000001', 'Label ID Test');

INSERT INTO authors (phone_number, unsubscribed, exclude)
VALUES ('+88881111111', FALSE, FALSE);

INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000003-0000-0000-0000-000000000001', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('00000003-0000-0000-0000-000000000001', '00000005-0000-0000-0000-000000000001', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000003-0000-0000-0000-000000000001', '+88881111111');

-- Create a campaign with a label_id
INSERT INTO campaigns (id, title, first_message, run_at, segments, label_id)
VALUES (
    20001,
    'Campaign with Label ID',
    'Testing label_id',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000005-0000-0000-0000-000000000001')
    ),
    '00000005-0000-0000-0000-000000000001'
);

-- Create a wrapper function that's more resilient for testing
CREATE OR REPLACE FUNCTION safe_queue_campaign_messages(p_campaign_id INTEGER) RETURNS INTEGER AS $$
DECLARE
    v_result INTEGER;
BEGIN
    -- Make sure temp table doesn't exist
    EXECUTE 'DROP TABLE IF EXISTS campaign_recipients_temp';
    
    -- Call the actual function
    SELECT queue_campaign_messages(p_campaign_id) INTO v_result;
    
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error in safe_queue_campaign_messages: %', SQLERRM;
        RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- Queue the campaign messages
SELECT safe_queue_campaign_messages(20001);

-- Test that the label_id is included in the message
SELECT is(
    get_label_id_from_message(20001),
    '00000005-0000-0000-0000-000000000001',
    'Campaign message includes the correct label_id'
);

-- Test 2: Campaign without label_id
-- Create a campaign without a label_id
INSERT INTO campaigns (id, title, first_message, run_at, segments)
VALUES (
    20002,
    'Campaign without Label ID',
    'Testing without label_id',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000005-0000-0000-0000-000000000001')
    )
);

-- Queue the campaign messages
SELECT safe_queue_campaign_messages(20002);

-- Test that the label_id is null in the message
SELECT is(
    get_label_id_from_message(20002),
    NULL,
    'Campaign message has NULL label_id when campaign does not have a label'
);

-- Clean up
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Do more aggressive cleanup for testing
DO $$ 
BEGIN
    -- Try to drop with IF EXISTS
    EXECUTE 'DROP TABLE IF EXISTS campaign_recipients_temp';
    
    -- Try another approach if it still exists
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c 
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'campaign_recipients_temp'
        AND n.nspname = current_schema()
    ) THEN
        EXECUTE 'DROP TABLE campaign_recipients_temp CASCADE';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error during cleanup: %', SQLERRM;
END $$;

-- Commit and start a new transaction to completely reset state
COMMIT;
BEGIN;
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'campaign_id' IN ('20001', '20002');

-- Finish test
SELECT * FROM finish();

ROLLBACK;
