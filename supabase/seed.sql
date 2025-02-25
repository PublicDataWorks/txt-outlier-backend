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
INSERT INTO conversations_labels (conversation_id, label_id, is_archived, author_phone_number) -- Include author_phone_number here
SELECT DISTINCT  -- DISTINCT to avoid duplicates
    c.id,
    l.id,
    false,
    ca.author_phone_number -- Populate author_phone_number during insert
FROM numbered_conversations c
CROSS JOIN generate_series(1, 3) n  -- Each conversation gets up to 3 labels
JOIN available_labels l
    ON l.label_num = (((c.conv_num - 1) * 3 + n) % 10) + 1  -- Distribute labels across conversations
JOIN conversations_authors ca ON c.id = ca.conversation_id -- Join with conversations_authors
ON CONFLICT (conversation_id, label_id) DO NOTHING;
