-- filename: migrations/20250310_add_file_based_campaigns.sql

ALTER TABLE campaigns
ALTER COLUMN segments DROP NOT NULL,
ADD COLUMN recipient_file_url TEXT;

-- Create campaign_file_recipients table for storing phone numbers from uploaded files
CREATE TABLE campaign_file_recipients (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_file_recipients_campaign_id ON campaign_file_recipients(campaign_id);

CREATE UNIQUE INDEX unique_phone_per_campaign ON campaign_file_recipients(phone_number, campaign_id);

ALTER TABLE authors ADD COLUMN added_via_file_upload BOOLEAN DEFAULT FALSE;
------------------------------------------------------------------------------
-- Helper function for segment-based recipients
CREATE OR REPLACE FUNCTION insert_segment_based_recipients(
    p_campaign_id INTEGER
) RETURNS VOID AS $$
DECLARE
    v_campaign_record campaigns%ROWTYPE;
    v_recipient_sql TEXT;
BEGIN
    SELECT * INTO v_campaign_record
    FROM campaigns
    WHERE id = p_campaign_id;

    -- Generate SQL to get recipients
    v_recipient_sql := '
    WITH RECURSIVE
      -- Extract segments from campaign
      campaign_data AS (
        SELECT
          ''' || v_campaign_record.segments::TEXT || '''::jsonb->''included'' AS p_included_segments,
          ''' || v_campaign_record.segments::TEXT || '''::jsonb->''excluded'' AS p_excluded_segments
      ),
      -- Process included segments based on type
      segments_prep AS (
        SELECT
          CASE
            WHEN jsonb_typeof(p_included_segments) = ''object''
            THEN jsonb_build_array(p_included_segments)
            ELSE p_included_segments
          END AS segments_array
        FROM campaign_data
      ),
      -- Extract all segment IDs from included segments
      segment_ids AS (
        SELECT jsonb_array_elements(segments_array) AS segment
        FROM segments_prep
      ),
      -- Process AND groups separately
      segment_items AS (
        SELECT
          segment,
          jsonb_typeof(segment) AS segment_type
        FROM segment_ids
      ),
      -- Single segments (direct use)
      single_segments AS (
        SELECT segment AS item
        FROM segment_items
        WHERE segment_type = ''object''
      ),
      -- AND groups (need to be expanded)
      and_groups AS (
        SELECT jsonb_array_elements(segment) AS item
        FROM segment_items
        WHERE segment_type = ''array''
      ),
      -- Combine all segments
      all_segments AS (
        SELECT item FROM single_segments
        UNION ALL
        SELECT item FROM and_groups
      ),
      -- Get all eligible authors
      eligible_authors AS (
        SELECT phone_number
        FROM authors
        WHERE unsubscribed = FALSE AND exclude = FALSE
      ),
      -- Get matching phone numbers for each segment
      matching_phones AS (
        SELECT DISTINCT ca.author_phone_number, fs.item
        FROM all_segments fs
        JOIN LATERAL (
          -- For each segment, get matching phone numbers
          SELECT ca.author_phone_number
          FROM conversations_labels cl
          JOIN conversations_authors ca ON cl.conversation_id = ca.conversation_id
          JOIN eligible_authors ea ON ca.author_phone_number = ea.phone_number
          WHERE
            cl.is_archived = FALSE
            AND cl.label_id = (fs.item->>''id'')::UUID
            AND (
              -- Apply date filter if present
              (fs.item->>''since'') IS NULL
              OR cl.created_at >= to_timestamp((fs.item->>''since'')::BIGINT)
            )
        ) ca ON TRUE
      ),
      -- Handle AND groups - group by phone and count labels
      phone_label_counts AS (
        SELECT
          author_phone_number,
          COUNT(DISTINCT (item->>''id'')::UUID) AS label_count
        FROM matching_phones
        GROUP BY author_phone_number
      ),
      -- For AND groups, get phones that have all required labels
      and_group_phones AS (
        SELECT DISTINCT si.segment, mp.author_phone_number
        FROM segment_items si
        JOIN matching_phones mp ON mp.item->>''id'' = ANY(
          ARRAY(
            SELECT jsonb_array_elements(si.segment)->>''id''
            WHERE si.segment_type = ''array''
          )
        )
        WHERE si.segment_type = ''array''
        GROUP BY si.segment, mp.author_phone_number
        HAVING COUNT(DISTINCT (mp.item->>''id'')::UUID) = jsonb_array_length(si.segment)
      ),
      -- Single segment phones
      single_segment_phones AS (
        SELECT DISTINCT author_phone_number
        FROM matching_phones
        WHERE (item->>''id'')::UUID IN (
          SELECT (segment->>''id'')::UUID
          FROM segment_items
          WHERE segment_type = ''object''
        )
      ),
      -- Combine all matching phones (OR logic between groups)
      included_phones AS (
        SELECT author_phone_number FROM single_segment_phones
        UNION
        SELECT author_phone_number FROM and_group_phones
      )';

    -- Add excluded segments logic if they exist
    IF v_campaign_record.segments->>'excluded' IS NOT NULL THEN
      v_recipient_sql := v_recipient_sql || ',
      -- Process excluded segments based on type
      excluded_segments_prep AS (
        SELECT
          CASE
            WHEN jsonb_typeof(p_excluded_segments) = ''object''
            THEN jsonb_build_array(p_excluded_segments)
            ELSE p_excluded_segments
          END AS segments_array
        FROM campaign_data
      ),
      -- Extract all segment IDs from excluded segments
      excluded_segment_ids AS (
        SELECT jsonb_array_elements(segments_array) AS segment
        FROM excluded_segments_prep
      ),
      -- Process AND groups separately
      excluded_segment_items AS (
        SELECT
          segment,
          jsonb_typeof(segment) AS segment_type
        FROM excluded_segment_ids
      ),
      -- Single segments (direct use)
      excluded_single_segments AS (
        SELECT segment AS item
        FROM excluded_segment_items
        WHERE segment_type = ''object''
      ),
      -- AND groups (need to be expanded)
      excluded_and_groups AS (
        SELECT jsonb_array_elements(segment) AS item
        FROM excluded_segment_items
        WHERE segment_type = ''array''
      ),
      -- Combine all segments
      excluded_all_segments AS (
        SELECT item FROM excluded_single_segments
        UNION ALL
        SELECT item FROM excluded_and_groups
      ),
      -- Get matching phone numbers for each segment
      excluded_matching_phones AS (
        SELECT DISTINCT ca.author_phone_number, fs.item
        FROM excluded_all_segments fs
        JOIN LATERAL (
          -- For each segment, get matching phone numbers
          SELECT ca.author_phone_number
          FROM conversations_labels cl
          JOIN conversations_authors ca ON cl.conversation_id = ca.conversation_id
          WHERE
            cl.is_archived = FALSE
            AND cl.label_id = (fs.item->>''id'')::UUID
            AND (
              -- Apply date filter if present
              (fs.item->>''since'') IS NULL
              OR cl.created_at >= to_timestamp((fs.item->>''since'')::BIGINT)
            )
        ) ca ON TRUE
      ),
      -- Handle AND groups - group by phone and count labels
      excluded_phone_label_counts AS (
        SELECT
          author_phone_number,
          COUNT(DISTINCT (item->>''id'')::UUID) AS label_count
        FROM excluded_matching_phones
        GROUP BY author_phone_number
      ),
      -- For AND groups, get phones that have all required labels
      excluded_and_group_phones AS (
        SELECT DISTINCT si.segment, mp.author_phone_number
        FROM excluded_segment_items si
        JOIN excluded_matching_phones mp ON mp.item->>''id'' = ANY(
          ARRAY(
            SELECT jsonb_array_elements(si.segment)->>''id''
            WHERE si.segment_type = ''array''
          )
        )
        WHERE si.segment_type = ''array''
        GROUP BY si.segment, mp.author_phone_number
        HAVING COUNT(DISTINCT (mp.item->>''id'')::UUID) = jsonb_array_length(si.segment)
      ),
      -- Single segment phones
      excluded_single_segment_phones AS (
        SELECT DISTINCT author_phone_number
        FROM excluded_matching_phones
        WHERE (item->>''id'')::UUID IN (
          SELECT (segment->>''id'')::UUID
          FROM excluded_segment_items
          WHERE segment_type = ''object''
        )
      ),
      -- Combine all matching phones (OR logic between groups)
      excluded_phones AS (
        SELECT author_phone_number FROM excluded_single_segment_phones
        UNION
        SELECT author_phone_number FROM excluded_and_group_phones
      )';
    END IF;

    -- Finalize the query with the appropriate filtering and insert into temp table
    IF v_campaign_record.segments->>'excluded' IS NOT NULL THEN
      v_recipient_sql := 'INSERT INTO campaign_recipients_temp (phone_number)
      ' || v_recipient_sql || '
      -- Get the final list of phone numbers (included - excluded)
      SELECT DISTINCT author_phone_number
      FROM included_phones
      WHERE NOT EXISTS (
        SELECT 1
        FROM excluded_phones
        WHERE excluded_phones.author_phone_number = included_phones.author_phone_number
      );';
    ELSE
      v_recipient_sql := 'INSERT INTO campaign_recipients_temp (phone_number)
      ' || v_recipient_sql || '
      -- Get the distinct recipient phone numbers
      SELECT DISTINCT author_phone_number
      FROM included_phones;';
    END IF;

    EXECUTE v_recipient_sql;
END;
$$ LANGUAGE plpgsql;

-- Helper function for file-based recipients
CREATE OR REPLACE FUNCTION insert_file_based_recipients(
    p_campaign_id INTEGER
) RETURNS VOID AS $$
BEGIN
    -- Insert recipients from file
    INSERT INTO campaign_recipients_temp (phone_number)
    SELECT phone_number
    FROM campaign_file_recipients
    WHERE campaign_id = p_campaign_id
    -- Filter to only include valid, non-unsubscribed recipients
    AND EXISTS (
        SELECT 1
        FROM authors a
        WHERE a.phone_number = campaign_file_recipients.phone_number
        AND a.unsubscribed = FALSE
        AND a.exclude = FALSE
    );
    DELETE FROM campaign_file_recipients WHERE campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Main function to queue campaign messages
CREATE OR REPLACE FUNCTION queue_campaign_messages(
    p_campaign_id INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_campaign_record campaigns%ROWTYPE;
    v_batch_size CONSTANT INTEGER := 100;
    v_offset INTEGER;
    v_total_recipients INTEGER;
    v_is_file_based BOOLEAN;
BEGIN
    -- Get campaign details
    SELECT * INTO v_campaign_record
    FROM campaigns
    WHERE id = p_campaign_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign with ID % not found', p_campaign_id;
    END IF;

    -- Determine if campaign is file-based or segment-based
    v_is_file_based := v_campaign_record.recipient_file_url IS NOT NULL;

    -- Create temporary table for recipients
    CREATE TEMPORARY TABLE campaign_recipients_temp (
        phone_number TEXT PRIMARY KEY
    );

    -- Get recipients based on campaign type
    IF v_is_file_based THEN
        -- Get recipients from file
        PERFORM insert_file_based_recipients(p_campaign_id);
        RAISE NOTICE 'Processing file-based campaign with recipient_file_url: %', v_campaign_record.recipient_file_url;
    ELSE
        -- Use existing segment-based logic
        PERFORM insert_segment_based_recipients(p_campaign_id);
        RAISE NOTICE 'Processing segment-based campaign';
    END IF;

    -- Count recipients
    SELECT COUNT(*) INTO v_total_recipients FROM campaign_recipients_temp;
    RAISE NOTICE 'Campaign % has % recipients', p_campaign_id, v_total_recipients;

    -- Queue messages in batches
    FOR v_offset IN 0..CEIL(v_total_recipients::FLOAT / v_batch_size) - 1 LOOP
        PERFORM pgmq.send_batch(
            'broadcast_first_messages',
            ARRAY(
                SELECT jsonb_build_object(
                    'recipient_phone_number', phone_number,
                    'campaign_id', p_campaign_id,
                    'first_message', v_campaign_record.first_message,
                    'second_message', v_campaign_record.second_message,
                    'title', v_campaign_record.title,
                    'delay', v_campaign_record.delay,
                    'label_id', v_campaign_record.label_id,
                    'created_at', EXTRACT(EPOCH FROM NOW())::INTEGER
                )
                FROM campaign_recipients_temp
                LIMIT v_batch_size
                OFFSET v_offset * v_batch_size
            )
        );
    END LOOP;

    -- Update the campaign's recipient count
    UPDATE campaigns
    SET recipient_count = v_total_recipients
    WHERE id = p_campaign_id;

    RAISE NOTICE 'Campaign % has been queued with % recipients', p_campaign_id, v_total_recipients;

    -- Return the number of recipients
    RETURN v_total_recipients;
END;
$$ LANGUAGE plpgsql;
