-- Populates the campaign data from the existing conversations_labels table
INSERT INTO campaign_segments (name, description, type, config, created_at)
SELECT
    l.name,
    'Segment based on label: ' || l.name,
    'label',
    jsonb_build_object('label_id', l.id::text),
    l.created_at
FROM labels l;
------------------------------------------------------------------------------
-- Migrate data from conversations_labels to campaign_segment_recipients
INSERT INTO campaign_segment_recipients
    (segment_id, phone_number)
SELECT DISTINCT
    cs.id as segment_id,
    ca.author_phone_number as phone_number
FROM conversations_labels cl
JOIN conversations_authors ca ON cl.conversation_id = ca.conversation_id
JOIN campaign_segments cs ON cs.type = 'label'
    AND (cs.config->>'label_id')::uuid = cl.label_id
WHERE
    ca.author_phone_number NOT IN (  -- Exclude authors who are unsubscribed or excluded
        SELECT phone_number
        FROM authors
        WHERE unsubscribed = true OR exclude = true
    );
