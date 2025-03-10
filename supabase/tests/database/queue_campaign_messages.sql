BEGIN;

-- Create a plan for our tests
SELECT plan(7);

-- Helper function to count messages in the queue for a specific campaign
CREATE OR REPLACE FUNCTION count_queued_messages(p_campaign_id INTEGER) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM pgmq.q_broadcast_first_messages
    WHERE message::jsonb->>'campaign_id' = p_campaign_id::TEXT;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Helper function to count messages for specific phone numbers
CREATE OR REPLACE FUNCTION count_queued_messages_for_phones(p_campaign_id INTEGER, p_phone_numbers TEXT[]) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM pgmq.q_broadcast_first_messages
    WHERE
        message::jsonb->>'campaign_id' = p_campaign_id::TEXT
        AND message::jsonb->>'recipient_phone_number' = ANY(p_phone_numbers);

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Clean any existing test messages from the queue
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'campaign_id' IN ('10001', '10002', '10003', '10004', '10005');

-- Clean up any temporary tables that might exist from previous runs
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Test 1: Basic test - Create a campaign with a segment that has 3 eligible authors
-- First clean up any existing test data
DELETE FROM conversations_authors WHERE conversation_id IN (
    '00000002-0000-0000-0000-000000000001',
    '00000002-0000-0000-0000-000000000002',
    '00000002-0000-0000-0000-000000000003',
    '00000002-0000-0000-0000-000000000004',
    '00000002-0000-0000-0000-000000000005',
    '00000002-0000-0000-0000-000000000006',
    '00000002-0000-0000-0000-000000000007',
    '00000002-0000-0000-0000-000000000008',
    '00000002-0000-0000-0000-000000000009'
);
DELETE FROM conversations_labels WHERE conversation_id IN (
    '00000002-0000-0000-0000-000000000001',
    '00000002-0000-0000-0000-000000000002',
    '00000002-0000-0000-0000-000000000003',
    '00000002-0000-0000-0000-000000000004',
    '00000002-0000-0000-0000-000000000005',
    '00000002-0000-0000-0000-000000000006',
    '00000002-0000-0000-0000-000000000007',
    '00000002-0000-0000-0000-000000000008',
    '00000002-0000-0000-0000-000000000009'
);
DELETE FROM conversations WHERE id IN (
    '00000002-0000-0000-0000-000000000001',
    '00000002-0000-0000-0000-000000000002',
    '00000002-0000-0000-0000-000000000003',
    '00000002-0000-0000-0000-000000000004',
    '00000002-0000-0000-0000-000000000005',
    '00000002-0000-0000-0000-000000000006',
    '00000002-0000-0000-0000-000000000007',
    '00000002-0000-0000-0000-000000000008',
    '00000002-0000-0000-0000-000000000009'
);
DELETE FROM authors WHERE phone_number LIKE '+999%';
DELETE FROM labels WHERE id IN (
    '00000001-0000-0000-0000-000000000001',
    '00000001-0000-0000-0000-000000000002',
    '00000001-0000-0000-0000-000000000003',
    '00000001-0000-0000-0000-000000000004'
);
DELETE FROM campaigns WHERE id IN (10001, 10002, 10003, 10004, 10005);

-- Create test data for label 1 with 3 eligible authors
INSERT INTO labels (id, name)
VALUES ('00000001-0000-0000-0000-000000000001', 'Test Label 1');

INSERT INTO authors (phone_number, unsubscribed, exclude)
VALUES
  ('+9991111111', FALSE, FALSE), -- eligible author 1
  ('+9992222222', FALSE, FALSE), -- eligible author 2
  ('+9993333333', FALSE, FALSE), -- eligible author 3
  ('+9994444444', FALSE, FALSE), -- eligible author 4
  ('+9995555555', TRUE, FALSE),  -- unsubscribed author
  ('+9996666666', FALSE, TRUE);  -- excluded author

INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000001', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000002', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000003', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001', FALSE),
  ('00000002-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000001', FALSE),
  ('00000002-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000001', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000001', '+9991111111'),
  ('00000002-0000-0000-0000-000000000002', '+9992222222'),
  ('00000002-0000-0000-0000-000000000003', '+9993333333');

INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay)
VALUES (
    10001,
    'Test Campaign 1',
    'First message text',
    'Second message text',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001')
    ),
    600
);

SELECT lives_ok(
    'SELECT queue_campaign_messages(10001)',
    'queue_campaign_messages executes successfully with single segment'
);

SELECT is(
    count_queued_messages(10001),
    3,
    'Campaign with single segment queued 3 messages (excluding archived/unsubscribed/excluded)'
);

-- Explicitly drop the temporary table after each test
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Test 2: Campaign with multiple segments (OR logic)
INSERT INTO labels (id, name)
VALUES ('00000001-0000-0000-0000-000000000002', 'Test Label 2');

INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000004', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000005', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000004', '00000001-0000-0000-0000-000000000002', FALSE),
  ('00000002-0000-0000-0000-000000000005', '00000001-0000-0000-0000-000000000002', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000004', '+9993333333'), -- already has label 1
  ('00000002-0000-0000-0000-000000000005', '+9994444444'); -- new author

INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay)
VALUES (
    10002,
    'Test Campaign 2',
    'First message text',
    'Second message text',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_array(
            jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
            jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
        )
    ),
    600
);

SELECT queue_campaign_messages(10002);

SELECT is(
    count_queued_messages(10002),
    4,
    'Campaign with multiple segments queued 4 messages (unique eligible recipients)'
);

-- Explicitly drop the temporary table after each test
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Test 3: Campaign with included and excluded segments
INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay)
VALUES (
    10003,
    'Test Campaign 3',
    'First message text',
    'Second message text',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
        'excluded', jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
    ),
    600
);

SELECT queue_campaign_messages(10003);

SELECT is(
    count_queued_messages(10003),
    2,
    'Campaign with excluded segment queued 2 messages (after excluding overlapping recipients)'
);

-- Explicitly drop the temporary table after each test
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Test 4: Verify the campaign recipient_count is updated
SELECT is(
    (SELECT recipient_count FROM campaigns WHERE id = 10003),
    2,
    'Campaign recipient_count field is updated correctly'
);

-- Test 5: Explicitly verify unsubscribed users are not included
INSERT INTO labels (id, name)
VALUES ('00000001-0000-0000-0000-000000000003', 'Test Label 3');

INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000002-0000-0000-0000-000000000006', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('00000002-0000-0000-0000-000000000006', '00000001-0000-0000-0000-000000000003', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000002-0000-0000-0000-000000000006', '+9995555555');

INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay)
VALUES (
    10004,
    'Test Campaign 4',
    'First message text',
    'Second message text',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000003')
    ),
    600
);

SELECT queue_campaign_messages(10004);

SELECT is(
    count_queued_messages(10004),
    0,
    'Campaign targeting only unsubscribed authors queues 0 messages'
);

-- Explicitly drop the temporary table after each test
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Test 6: Explicitly verify that unsubscribed/excluded users are filtered out
INSERT INTO labels (id, name)
VALUES ('00000001-0000-0000-0000-000000000004', 'Test Label 4');

INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000007', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000008', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000009', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000007', '00000001-0000-0000-0000-000000000004', FALSE),
  ('00000002-0000-0000-0000-000000000008', '00000001-0000-0000-0000-000000000004', FALSE),
  ('00000002-0000-0000-0000-000000000009', '00000001-0000-0000-0000-000000000004', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000007', '+9991111111'), -- eligible
  ('00000002-0000-0000-0000-000000000008', '+9995555555'), -- unsubscribed
  ('00000002-0000-0000-0000-000000000009', '+9996666666'); -- excluded

INSERT INTO campaigns (id, title, first_message, second_message, run_at, segments, delay)
VALUES (
    10005,
    'Test Campaign 5',
    'First message text',
    'Second message text',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    jsonb_build_object(
        'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000004')
    ),
    600
);

SELECT queue_campaign_messages(10005);

-- Combined test for both cases
SELECT is(
    count_queued_messages_for_phones(10005, ARRAY['+9995555555', '+9996666666']),
    0,
    'No messages are queued for unsubscribed or excluded authors'
);

-- Explicitly drop the temporary table after the final test
DROP TABLE IF EXISTS campaign_recipients_temp;

-- Clean up
DELETE FROM pgmq.q_broadcast_first_messages WHERE message::jsonb->>'campaign_id' IN ('10001', '10002', '10003', '10004', '10005');
SELECT * FROM finish();
ROLLBACK;
