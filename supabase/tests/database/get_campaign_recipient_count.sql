BEGIN;

-- Create a plan for our tests
SELECT plan(11);

-- Clean up existing test data
DELETE FROM authors WHERE phone_number LIKE '+999%';
DELETE FROM conversations WHERE id::text LIKE '00000002-%' OR web_url = 'https://test.com';
DELETE FROM labels WHERE id::text LIKE '00000001-%';

-- Create test data with proper UUID format
INSERT INTO labels (id, name)
VALUES
  ('00000001-0000-0000-0000-000000000001', 'Test Label 1'),
  ('00000001-0000-0000-0000-000000000002', 'Test Label 2'),
  ('00000001-0000-0000-0000-000000000003', 'Test Label 3'),
  ('00000001-0000-0000-0000-000000000004', 'Test Label 4');

INSERT INTO authors (phone_number, unsubscribed, exclude)
VALUES
  ('+9991111111', FALSE, FALSE), -- eligible author 1
  ('+9992222222', FALSE, FALSE), -- eligible author 2
  ('+9993333333', FALSE, FALSE), -- eligible author 3
  ('+9994444444', FALSE, FALSE), -- eligible author 4
  ('+9995555555', TRUE, FALSE),  -- unsubscribed author
  ('+9996666666', FALSE, TRUE),  -- excluded author
  ('+9997777777', FALSE, FALSE); -- eligible author 5 (for later tests)

INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000001', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000002', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000003', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000004', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000005', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000006', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000007', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000008', 'https://test.com', 'https://test.com');

-- Create conversation-label relationships
INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001', FALSE),
  ('00000002-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000001', FALSE),
  ('00000002-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000001', FALSE),
  ('00000002-0000-0000-0000-000000000004', '00000001-0000-0000-0000-000000000001', TRUE),  -- archived, should be excluded
  ('00000002-0000-0000-0000-000000000005', '00000001-0000-0000-0000-000000000002', FALSE),
  ('00000002-0000-0000-0000-000000000006', '00000001-0000-0000-0000-000000000002', FALSE),
  ('00000002-0000-0000-0000-000000000007', '00000001-0000-0000-0000-000000000003', FALSE),
  ('00000002-0000-0000-0000-000000000008', '00000001-0000-0000-0000-000000000003', FALSE);

-- Create conversation-author relationships
INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000001', '+9991111111'), -- label 1, eligible
  ('00000002-0000-0000-0000-000000000002', '+9992222222'), -- label 1, eligible
  ('00000002-0000-0000-0000-000000000003', '+9993333333'), -- label 1, eligible
  ('00000002-0000-0000-0000-000000000004', '+9994444444'), -- label 1, but archived
  ('00000002-0000-0000-0000-000000000005', '+9991111111'), -- label 2, eligible (same as conv-1)
  ('00000002-0000-0000-0000-000000000006', '+9994444444'), -- label 2, eligible
  ('00000002-0000-0000-0000-000000000007', '+9995555555'), -- label 3, unsubscribed
  ('00000002-0000-0000-0000-000000000008', '+9996666666'); -- label 3, excluded

-- Test 1: Single segment
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001')
    )
  ),
  3,
  'Single segment should return 3 eligible recipients'
);

-- Test 2: Multiple segments (OR logic)
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_array(
        jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
        jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
      )
    )
  ),
  4,
  'Multiple segments with OR logic should return 4 eligible recipients'
);

-- Test 3: Included and excluded segments
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
      'excluded', jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
    )
  ),
  2,
  'Label 1 minus Label 2 should return 2 eligible recipients'
);

-- Test 4: Segment with only unsubscribed or excluded authors
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000003')
    )
  ),
  0,
  'Segment with only unsubscribed or excluded authors should return 0'
);

-- Test 5: AND logic (authors with both labels)
-- First, create an author with both labels
INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000002-0000-0000-0000-000000000009', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('00000002-0000-0000-0000-000000000009', '00000001-0000-0000-0000-000000000001', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000002-0000-0000-0000-000000000009', '+9994444444'); -- This author now has both label 1 and label 2

SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_array(
        jsonb_build_array(
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
        )
      )
    )
  ),
  2,
  'AND logic should return 2 authors who have both labels'
);

-- Test 6: Complex combination (OR of ANDs)
-- Create data for this test
INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000010', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000011', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000010', '00000001-0000-0000-0000-000000000002', FALSE),
  ('00000002-0000-0000-0000-000000000011', '00000001-0000-0000-0000-000000000003', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000010', '+9997777777'),
  ('00000002-0000-0000-0000-000000000011', '+9997777777');

SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_array(
        jsonb_build_array(
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000001'),
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000002')
        ),
        jsonb_build_array(
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000002'),
          jsonb_build_object('id', '00000001-0000-0000-0000-000000000003')
        )
      )
    )
  ),
  3,
  'OR of ANDs should return 3 authors (2 with labels 1+2, 1 with labels 2+3)'
);

-- Test 7: Empty result
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000999')
    )
  ),
  0,
  'Non-existent label should return 0 recipients'
);

-- Test 8: Since parameter (time filtering)
-- Reset data for this test to get a clean count
DELETE FROM conversations_labels WHERE label_id = '00000001-0000-0000-0000-000000000001';
DELETE FROM conversations_authors WHERE conversation_id IN (
  '00000002-0000-0000-0000-000000000001',
  '00000002-0000-0000-0000-000000000002',
  '00000002-0000-0000-0000-000000000003',
  '00000002-0000-0000-0000-000000000004',
  '00000002-0000-0000-0000-000000000009'
);

-- Insert older data (created more than 1 hour ago)
INSERT INTO conversations_labels (conversation_id, label_id, is_archived, created_at)
VALUES
  ('00000002-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001', FALSE, CURRENT_TIMESTAMP - INTERVAL '2 hours'),
  ('00000002-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000001', FALSE, CURRENT_TIMESTAMP - INTERVAL '2 hours'),
  ('00000002-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000001', FALSE, CURRENT_TIMESTAMP - INTERVAL '2 hours');

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000001', '+9991111111'),
  ('00000002-0000-0000-0000-000000000002', '+9992222222'),
  ('00000002-0000-0000-0000-000000000003', '+9993333333');

-- Insert newer data (created less than 1 hour ago)
INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000002-0000-0000-0000-000000000012', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived, created_at)
VALUES ('00000002-0000-0000-0000-000000000012', '00000001-0000-0000-0000-000000000001', FALSE, CURRENT_TIMESTAMP);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000002-0000-0000-0000-000000000012', '+9997777777');

-- Use a timestamp from 1 hour ago
SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object(
        'id', '00000001-0000-0000-0000-000000000001',
        'since', EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - INTERVAL '1 hour'))::INTEGER
      )
    )
  ),
  1,
  'Label with since parameter should only include recent conversations'
);

-- Test 9: Excluded authors should not be counted
-- Reset data for a clean test
DELETE FROM conversations_labels WHERE label_id = '00000001-0000-0000-0000-000000000001';
DELETE FROM conversations_authors WHERE conversation_id IN (
  '00000002-0000-0000-0000-000000000001',
  '00000002-0000-0000-0000-000000000002',
  '00000002-0000-0000-0000-000000000003',
  '00000002-0000-0000-0000-000000000012'
);

-- Insert baseline data - 3 eligible authors
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

-- Add an excluded author to the same label
INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000002-0000-0000-0000-000000000013', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('00000002-0000-0000-0000-000000000013', '00000001-0000-0000-0000-000000000001', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000002-0000-0000-0000-000000000013', '+9996666666'); -- excluded author

SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001')
    )
  ),
  3, -- still 3, not 4, because the new author is excluded
  'Excluded authors should not be counted'
);

-- Test 10: Unsubscribed authors should not be counted
-- Add an unsubscribed author to the same label
INSERT INTO conversations (id, web_url, app_url)
VALUES ('00000002-0000-0000-0000-000000000014', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES ('00000002-0000-0000-0000-000000000014', '00000001-0000-0000-0000-000000000001', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES ('00000002-0000-0000-0000-000000000014', '+9995555555'); -- unsubscribed author

SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000001')
    )
  ),
  3, -- still 3, not 4, because the new author is unsubscribed
  'Unsubscribed authors should not be counted'
);

-- Test 11: Label with mixed eligible and ineligible authors
-- Create a new label with both eligible and ineligible authors
DELETE FROM conversations_labels WHERE label_id = '00000001-0000-0000-0000-000000000004';
DELETE FROM conversations_authors WHERE conversation_id IN (
  '00000002-0000-0000-0000-000000000015',
  '00000002-0000-0000-0000-000000000016',
  '00000002-0000-0000-0000-000000000017'
);

INSERT INTO conversations (id, web_url, app_url)
VALUES
  ('00000002-0000-0000-0000-000000000015', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000016', 'https://test.com', 'https://test.com'),
  ('00000002-0000-0000-0000-000000000017', 'https://test.com', 'https://test.com');

INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
VALUES
  ('00000002-0000-0000-0000-000000000015', '00000001-0000-0000-0000-000000000004', FALSE),
  ('00000002-0000-0000-0000-000000000016', '00000001-0000-0000-0000-000000000004', FALSE),
  ('00000002-0000-0000-0000-000000000017', '00000001-0000-0000-0000-000000000004', FALSE);

INSERT INTO conversations_authors (conversation_id, author_phone_number)
VALUES
  ('00000002-0000-0000-0000-000000000015', '+9991111111'), -- eligible
  ('00000002-0000-0000-0000-000000000016', '+9995555555'), -- unsubscribed
  ('00000002-0000-0000-0000-000000000017', '+9996666666'); -- excluded

SELECT is(
  get_campaign_recipient_count(
    jsonb_build_object(
      'included', jsonb_build_object('id', '00000001-0000-0000-0000-000000000004')
    )
  ),
  1, -- Only 1 eligible author out of 3 total
  'Label with mixed eligible and ineligible authors should only count eligible ones'
);

-- Clean up
SELECT * FROM finish();
ROLLBACK;
