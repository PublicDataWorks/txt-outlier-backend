CREATE OR REPLACE FUNCTION get_campaign_recipient_count(
  p_segments JSONB
) RETURNS INTEGER AS $$
DECLARE
  included_phone_numbers TEXT[];
  excluded_phone_numbers TEXT[];
  p_included_segments JSONB;
  p_excluded_segments JSONB;
  phone_count INTEGER;
BEGIN
  -- Extract included and excluded segments from the input
  p_included_segments := p_segments->'included';
  p_excluded_segments := p_segments->'excluded';

  -- Get phone numbers for included segments
  WITH RECURSIVE
    -- Process included segments based on type
    segments_prep AS (
      SELECT
        CASE
          WHEN jsonb_typeof(p_included_segments) = 'object'
          THEN jsonb_build_array(p_included_segments)
          ELSE p_included_segments
        END AS segments_array
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
      WHERE segment_type = 'object'
    ),
    -- AND groups (need to be expanded)
    and_groups AS (
      SELECT jsonb_array_elements(segment) AS item
      FROM segment_items
      WHERE segment_type = 'array'
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
          AND cl.label_id = (fs.item->>'id')::UUID
          AND (
            -- Apply date filter if present
            (fs.item->>'since') IS NULL
            OR cl.created_at >= to_timestamp((fs.item->>'since')::BIGINT)
          )
      ) ca ON TRUE
    ),
    -- Handle AND groups - group by phone and count labels
    phone_label_counts AS (
      SELECT
        author_phone_number,
        COUNT(DISTINCT (item->>'id')::UUID) AS label_count
      FROM matching_phones
      GROUP BY author_phone_number
    ),
    -- For AND groups, get phones that have all required labels
    and_group_phones AS (
      SELECT DISTINCT si.segment, mp.author_phone_number
      FROM segment_items si
      JOIN matching_phones mp ON mp.item->>'id' = ANY(
        ARRAY(
          SELECT jsonb_array_elements(si.segment)->>'id'
          WHERE si.segment_type = 'array'
        )
      )
      WHERE si.segment_type = 'array'
      GROUP BY si.segment, mp.author_phone_number
      HAVING COUNT(DISTINCT (mp.item->>'id')::UUID) = jsonb_array_length(si.segment)
    ),
    -- Single segment phones
    single_segment_phones AS (
      SELECT DISTINCT author_phone_number
      FROM matching_phones
      WHERE (item->>'id')::UUID IN (
        SELECT (segment->>'id')::UUID
        FROM segment_items
        WHERE segment_type = 'object'
      )
    ),
    -- Combine all matching phones (OR logic between groups)
    final_included_phones AS (
      SELECT author_phone_number FROM single_segment_phones
      UNION
      SELECT author_phone_number FROM and_group_phones
    )
    -- Get the final array of included phone numbers
    SELECT ARRAY_AGG(DISTINCT author_phone_number) INTO included_phone_numbers
    FROM final_included_phones;

  -- If excluded segments are provided, get those phone numbers
  IF p_excluded_segments IS NOT NULL THEN
    WITH RECURSIVE
      -- Process excluded segments based on type
      segments_prep AS (
        SELECT
          CASE
            WHEN jsonb_typeof(p_excluded_segments) = 'object'
            THEN jsonb_build_array(p_excluded_segments)
            ELSE p_excluded_segments
          END AS segments_array
      ),
      -- Extract all segment IDs from excluded segments
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
        WHERE segment_type = 'object'
      ),
      -- AND groups (need to be expanded)
      and_groups AS (
        SELECT jsonb_array_elements(segment) AS item
        FROM segment_items
        WHERE segment_type = 'array'
      ),
      -- Combine all segments
      all_segments AS (
        SELECT item FROM single_segments
        UNION ALL
        SELECT item FROM and_groups
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
          WHERE
            cl.is_archived = FALSE
            AND cl.label_id = (fs.item->>'id')::UUID
            AND (
              -- Apply date filter if present
              (fs.item->>'since') IS NULL
              OR cl.created_at >= to_timestamp((fs.item->>'since')::BIGINT)
            )
        ) ca ON TRUE
      ),
      -- Handle AND groups - group by phone and count labels
      phone_label_counts AS (
        SELECT
          author_phone_number,
          COUNT(DISTINCT (item->>'id')::UUID) AS label_count
        FROM matching_phones
        GROUP BY author_phone_number
      ),
      -- For AND groups, get phones that have all required labels
      and_group_phones AS (
        SELECT DISTINCT si.segment, mp.author_phone_number
        FROM segment_items si
        JOIN matching_phones mp ON mp.item->>'id' = ANY(
          ARRAY(
            SELECT jsonb_array_elements(si.segment)->>'id'
            WHERE si.segment_type = 'array'
          )
        )
        WHERE si.segment_type = 'array'
        GROUP BY si.segment, mp.author_phone_number
        HAVING COUNT(DISTINCT (mp.item->>'id')::UUID) = jsonb_array_length(si.segment)
      ),
      -- Single segment phones
      single_segment_phones AS (
        SELECT DISTINCT author_phone_number
        FROM matching_phones
        WHERE (item->>'id')::UUID IN (
          SELECT (segment->>'id')::UUID
          FROM segment_items
          WHERE segment_type = 'object'
        )
      ),
      -- Combine all matching phones (OR logic between groups)
      final_excluded_phones AS (
        SELECT author_phone_number FROM single_segment_phones
        UNION
        SELECT author_phone_number FROM and_group_phones
      )
      -- Get the final array of excluded phone numbers
      SELECT ARRAY_AGG(DISTINCT author_phone_number) INTO excluded_phone_numbers
      FROM final_excluded_phones;
  END IF;

  -- Count the final set of phone numbers (included - excluded)
  IF included_phone_numbers IS NULL THEN
    RETURN 0;
  ELSIF excluded_phone_numbers IS NULL OR array_length(excluded_phone_numbers, 1) = 0 THEN
    RETURN array_length(included_phone_numbers, 1);
  ELSE
    SELECT COUNT(*) INTO phone_count
    FROM (
      SELECT unnest(included_phone_numbers) AS phone_number
      EXCEPT
      SELECT unnest(excluded_phone_numbers) AS phone_number
    ) phones;

    RETURN phone_count;
  END IF;
END;
$$ LANGUAGE plpgsql;
----------------------------------------------------------
DROP FUNCTION IF EXISTS queue_campaign_messages(INTEGER);
CREATE OR REPLACE FUNCTION queue_campaign_messages(
    p_campaign_id INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_campaign_record campaigns%ROWTYPE;
    v_recipient_sql TEXT;
    v_batch_size CONSTANT INTEGER := 100;
    v_offset INTEGER;
    v_total_recipients INTEGER;
BEGIN
    SELECT * INTO v_campaign_record
    FROM campaigns
    WHERE id = p_campaign_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign with ID % not found', p_campaign_id;
    END IF;

    CREATE TEMPORARY TABLE campaign_recipients_temp (
        phone_number TEXT PRIMARY KEY
    );

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

    SELECT COUNT(*) INTO v_total_recipients FROM campaign_recipients_temp;
    RAISE NOTICE 'Campaign % has % recipients', p_campaign_id, v_total_recipients;

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
-------------------------------------------------------
CREATE OR REPLACE FUNCTION check_and_run_campaigns()
RETURNS jsonb AS $$
DECLARE
    campaign_record campaigns%ROWTYPE;
    current_timestamp_utc TIMESTAMP WITH TIME ZONE;
    campaigns_to_run INTEGER;
    campaign_ids INTEGER[];
    future_timestamp TIMESTAMP WITH TIME ZONE;
    cron_expression TEXT;
    service_key TEXT;
    edge_url TEXT;
    cron_command TEXT;
    recipient_count INTEGER;
    seconds_to_add INTEGER;
BEGIN
    current_timestamp_utc := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
    SELECT array_agg(id), COUNT(*) INTO campaign_ids, campaigns_to_run
    FROM campaigns
    WHERE
        date_trunc('minute', run_at) = date_trunc('minute', current_timestamp_utc)
        AND processed IS FALSE;

    RAISE LOG '[check_and_run_campaigns] Checking for campaigns to run. Current time: %, Found: %',
        current_timestamp_utc, campaigns_to_run;

    IF campaigns_to_run = 0 OR campaign_ids IS NULL THEN
        RAISE WARNING '[check_and_run_campaigns] No campaigns scheduled to run at this time';
        RETURN jsonb_build_object('status', 'no_campaigns_to_run');
    END IF;

    RAISE WARNING '[check_and_run_campaigns] Found % campaigns to run. IDs: %',
        campaigns_to_run, campaign_ids;

    FOR campaign_record IN
        SELECT * FROM campaigns
        WHERE id = ANY(campaign_ids)
    LOOP
        recipient_count := queue_campaign_messages(campaign_record.id);
        UPDATE campaigns
        SET processed = TRUE
        WHERE id = campaign_record.id;

        seconds_to_add := (recipient_count * 2) + 1200;
        IF campaign_record.delay IS NOT NULL THEN
          seconds_to_add := seconds_to_add + campaign_record.delay;
        END IF;
        future_timestamp := current_timestamp_utc + (seconds_to_add || ' seconds')::interval;
        cron_expression :=
            EXTRACT(MINUTE FROM future_timestamp) || ' ' ||
            EXTRACT(HOUR FROM future_timestamp) || ' ' ||
            EXTRACT(DAY FROM future_timestamp) || ' ' ||
            EXTRACT(MONTH FROM future_timestamp) || ' ' ||
            '*';

        SELECT decrypted_secret INTO service_key
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key';

        SELECT decrypted_secret INTO edge_url
        FROM vault.decrypted_secrets
        WHERE name = 'edge_function_url';

        cron_command := format(
          'SELECT cron.schedule(
            ''reconcile-twilio-status'',
            ''* * * * *'',
            ''SELECT net.http_post(
              url:=''''%s/reconcile-twilio-status/'''',
              body:=''''{"campaignId": %s, "runAt": %s}''''::jsonb,
              headers:=''''{
                "Content-Type": "application/json",
                "Authorization": "Bearer %s"
                }''''::jsonb)
            as request_id;''
          );',
          edge_url,
          campaign_record.id,
          EXTRACT(EPOCH FROM current_timestamp_utc)::INTEGER,
          service_key
        );

       PERFORM cron.schedule(
            'delay-reconcile-twilio-status',
            cron_expression,
            cron_command
        );

        RAISE WARNING '[check_and_run_campaigns] Queued campaign ID: %', campaign_record.id;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'queued',
        'campaigns_run', campaigns_to_run,
        'campaign_ids', campaign_ids
    );
END;
$$ LANGUAGE plpgsql;
--------------------------------------------------------
ALTER TABLE conversations_labels DROP COLUMN author_phone_number;
