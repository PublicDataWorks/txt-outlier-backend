INSERT INTO "public"."audience_segments" ("id", "created_at", "query", "description", "name")
VALUES ('1', '2024-02-06 08:04:42.718926+00', 'SELECT a.phone_number FROM public.authors a ORDER BY random()',
        ' Query for testing', 'Test');
INSERT INTO "public"."audience_segments" ("id", "created_at", "query", "description", "name")
VALUES ('2', '2024-03-04 10:49:29.437967+00', 'SELECT a.phone_number FROM public.authors a ORDER BY RANDOM()',
        '50% everyone else (excluding unsubscribed users)', 'Inactive');
INSERT INTO "public"."broadcasts" ("id", "delay", "updated_at", "editable", "no_users",
                                   "first_message", "second_message", "twilio_paging")
VALUES ('473', 600, null, 'true', '10',
        'Test first message', 'Test second message', null);
INSERT INTO "public"."authors" ("created_at", "updated_at", "name", "phone_number", "unsubscribed")
VALUES ('2024-03-12 08:47:53.568392+00', null, 'People 1', '+13126185863', 'false');
INSERT INTO "public"."authors" ("created_at", "updated_at", "name", "phone_number", "unsubscribed")
VALUES ('2024-03-12 08:47:53.568392+00', null, 'People 2', '+14156694691', 'false');
INSERT INTO "public"."broadcasts_segments" ("broadcast_id", "segment_id", "ratio", "first_message", "second_message")
VALUES ('473', '1', '100', null, null);
INSERT INTO broadcast_settings (mon, tue, wed, thu, fri, sat, sun, active)
VALUES ('09:00:00', '09:00:00', '09:00:00', '09:00:00', null, null, null, true),
       (null, '12:30:00', '12:30:00', null, '12:30:00', null, null, false);

-- campaign data
INSERT INTO labels (
    id,
    name,
    name_with_parent_names,
    color,
    parent,
    share_with_organization,
    visibility,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),  -- unique id for each label
    'Label ' || LPAD(n::text, 3, '0'),  -- Label 001, Label 002, etc.
    'Label ' || LPAD(n::text, 3, '0'),  -- same as name since no parent
    CASE (n % 6)  -- rotate through some common colors
        WHEN 0 THEN '#FF0000'  -- red
        WHEN 1 THEN '#00FF00'  -- green
        WHEN 2 THEN '#0000FF'  -- blue
        WHEN 3 THEN '#FFFF00'  -- yellow
        WHEN 4 THEN '#FF00FF'  -- magenta
        WHEN 5 THEN '#00FFFF'  -- cyan
    END,
    NULL,  -- no parent
    false,
    'organization',
    NOW() - (n || ' hours')::interval,  -- stagger creation times
    NOW() - (n || ' minutes')::interval  -- stagger update times
FROM generate_series(1, 10) n  -- Create 10 labels
ON CONFLICT (id) DO NOTHING;

INSERT INTO authors (phone_number, name, unsubscribed, exclude, created_at)
SELECT
    'TEST-' || LPAD(n::text, 3, '0'),  -- Creates TEST-001, TEST-002, etc.
    'Test Author ' || LPAD(n::text, 3, '0'),
    false,
    false,
    NOW() - (n || ' hours')::interval
FROM generate_series(1, 50) n  -- Create 50 test authors
ON CONFLICT (phone_number) DO NOTHING;


INSERT INTO conversations (id, web_url, app_url, created_at)
SELECT
    gen_random_uuid(),
    'https://test.com/web/' || LPAD(n::text, 3, '0'),
    'app://test.com/app/' || LPAD(n::text, 3, '0'),
    NOW() - (n || ' hours')::interval
FROM generate_series(1, 30) n  -- Create 30 conversations
ON CONFLICT (id) DO NOTHING;

WITH numbered_conversations AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as conv_num
    FROM conversations
    WHERE web_url LIKE 'https://test.com/web/%'  -- Only select our test conversations
),
numbered_authors AS (
    SELECT phone_number, ROW_NUMBER() OVER (ORDER BY created_at) as author_num
    FROM authors
    WHERE phone_number LIKE 'TEST-%'  -- Only select our test authors
)

INSERT INTO conversations_authors (conversation_id, author_phone_number)
SELECT
    c.id,
    a.phone_number
FROM numbered_conversations c
JOIN numbered_authors a
    ON a.author_num = c.conv_num  -- One-to-one mapping
WHERE a.author_num <= (SELECT COUNT(*) FROM conversations WHERE web_url LIKE 'https://test.com/web/%')
ON CONFLICT (conversation_id, author_phone_number) DO NOTHING;


WITH numbered_conversations AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as conv_num
    FROM conversations
    WHERE web_url LIKE 'https://test.com/web/%'  -- Only select our test conversations
),
available_labels AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as label_num
    FROM labels
    LIMIT 10  -- Use only first 10 labels
)
INSERT INTO conversations_labels (conversation_id, label_id, is_archived)
SELECT DISTINCT  -- DISTINCT to avoid duplicates
    c.id,
    l.id,
    false
FROM numbered_conversations c
CROSS JOIN generate_series(1, 3) n  -- Each conversation gets up to 3 labels
JOIN available_labels l
    ON l.label_num = (((c.conv_num - 1) * 3 + n) % 10) + 1  -- Distribute labels across conversations
ON CONFLICT (conversation_id, label_id) DO NOTHING;
-- Insert data for Campaign
INSERT INTO campaigns (
    title,
    first_message,
    second_message,
    segments,
    delay,
    run_at,
    created_at,
    updated_at,
    recipient_count,
    processed
)
SELECT
    CASE
        WHEN n % 4 = 0 THEN 'Welcome Campaign'
        WHEN n % 4 = 1 THEN 'Product Update'
        WHEN n % 4 = 2 THEN 'Special Offer'
        WHEN n % 4 = 3 THEN 'Feedback Request'
    END || ' ' || LPAD(n::text, 3, '0'),

    CASE
        WHEN n % 4 = 0 THEN 'Hi there! Welcome to our community. We''re excited to have you join us!'
        WHEN n % 4 = 1 THEN 'We''ve just released some exciting new features that we think you''ll love.'
        WHEN n % 4 = 2 THEN 'For a limited time, we''re offering a special discount just for our valued customers.'
        WHEN n % 4 = 3 THEN 'We value your opinion! Could you take a moment to share your thoughts with us?'
    END,

    CASE
        WHEN n % 4 = 0 THEN 'Feel free to reply with any questions you might have. We''re here to help!'
        WHEN n % 4 = 1 THEN 'Have you had a chance to try our new features? We''d love to hear what you think!'
        WHEN n % 4 = 2 THEN 'Don''t miss out on this limited-time offer. It expires soon!'
        WHEN n % 4 = 3 THEN 'Thank you for your feedback! It helps us improve our service for everyone.'
    END,

    -- Segments JSON with varying configurations
    CASE
        WHEN n % 3 = 0 THEN
            '{"included": [{"id": "' || (SELECT id FROM labels ORDER BY created_at LIMIT 1 OFFSET (n % 10)) || '"}]}'
        WHEN n % 3 = 1 THEN
            '{"included": [{"id": "' || (SELECT id FROM labels ORDER BY created_at LIMIT 1 OFFSET (n % 10)) || '"}]}'
        ELSE
            '{"included": [{"id": "' || (SELECT id FROM labels ORDER BY created_at LIMIT 1 OFFSET (n % 10)) || '"}, {"id": "' || (SELECT id FROM labels ORDER BY created_at LIMIT 1 OFFSET ((n+1) % 10)) || '"}], "excluded": [{"id": "' || (SELECT id FROM labels ORDER BY created_at LIMIT 1 OFFSET ((n+2) % 10)) || '"}]}'
    END::jsonb,

    -- Delay varies between 600 and 1800 seconds
    600 + (n % 3) * 600,

    -- Run at times: 25 past and 5 upcoming
    CASE
        WHEN n <= 25 THEN NOW() - ((26 - n) || ' days')::interval  -- Past campaigns
        WHEN n = 26 THEN NOW() + '2 hours'::interval                -- Today but later
        WHEN n = 27 THEN NOW() + '1 day'::interval                  -- Tomorrow
        WHEN n = 28 THEN NOW() + '3 days'::interval                 -- This week
        WHEN n = 29 THEN NOW() + '1 week'::interval                 -- Next week
        WHEN n = 30 THEN NOW() + '2 weeks'::interval                -- Further in future
    END,

    -- Created times staggered
    NOW() - ((30 - n) || ' hours')::interval,
    NOW() - ((30 - n) || ' minutes')::interval,

    -- Recipient count varies
    CASE
        WHEN n % 5 = 0 THEN 1234
        WHEN n % 5 = 1 THEN 567
        WHEN n % 5 = 2 THEN 89
        WHEN n % 5 = 3 THEN 3456
        ELSE 789
    END,

    -- Mark past campaigns as processed
    CASE
        WHEN n <= 25 THEN true  -- Past campaigns are processed
        ELSE false              -- Upcoming campaigns are not processed
    END
FROM generate_series(1, 30) n;  -- Create 30 campaigns total
