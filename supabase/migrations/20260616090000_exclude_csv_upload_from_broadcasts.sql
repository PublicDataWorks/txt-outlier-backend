CREATE OR REPLACE FUNCTION public.queue_broadcast_messages(
    p_broadcast_id int
) RETURNS void
SET search_path = public, pg_temp
AS $$
DECLARE
    v_first_message text;
    v_second_message text;
    v_segment_record RECORD;
    v_delay int;
    v_offset int;
    v_target_users int;
    v_batch_size constant int := 100;
    v_current_count int;
    v_inactive_segment_id int;
BEGIN
    -- Get broadcast info
    SELECT
        first_message,
        second_message,
        no_users,
        delay INTO
        v_first_message,
        v_second_message,
        v_target_users,
        v_delay
    FROM public.broadcasts
    WHERE id = p_broadcast_id;

    DROP TABLE IF EXISTS pg_temp.recipients_temp; -- Could be ON COMMIT DROP
    CREATE TEMPORARY TABLE recipients_temp (
        phone_number text PRIMARY KEY,
        segment_id int
    ) ON COMMIT DROP;

    DROP TABLE IF EXISTS pg_temp.broadcast_excluded_recipients_temp;
    CREATE TEMPORARY TABLE broadcast_excluded_recipients_temp (
        phone_number text PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO broadcast_excluded_recipients_temp (phone_number)
    SELECT excluded.phone_number
    FROM (
        SELECT a.phone_number
        FROM public.authors a
        WHERE COALESCE(a.added_via_file_upload, FALSE) = TRUE

        UNION

        SELECT ca.author_phone_number AS phone_number
        FROM public.conversations_authors ca
        JOIN public.conversations_labels cl
            ON cl.conversation_id = ca.conversation_id
        JOIN public.labels l
            ON l.id = cl.label_id
        WHERE cl.is_archived = FALSE
        AND (
            UPPER(BTRIM(l.name)) = 'CSV UPLOAD'
            OR UPPER(BTRIM(l.name_with_parent_names)) = 'CSV UPLOAD'
            OR UPPER(BTRIM(l.name_with_parent_names)) LIKE '%/CSV UPLOAD'
        )
    ) excluded
    ON CONFLICT (phone_number) DO NOTHING;

    -- Process regular segments with their ratios
    FOR v_segment_record IN (
        SELECT
            bs.segment_id,
            s.query,
            FLOOR(bs.ratio * v_target_users / 100) as segment_limit
        FROM public.broadcasts_segments bs
        JOIN public.audience_segments s ON s.id = bs.segment_id
        WHERE bs.broadcast_id = p_broadcast_id
        AND s.name != 'Inactive'
    ) LOOP
        EXECUTE format(
            'INSERT INTO recipients_temp (phone_number, segment_id)
            SELECT DISTINCT sq.phone_number, %s as segment_id
            FROM (%s LIMIT %s) AS sq
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_temp.recipients_temp rt
                WHERE rt.phone_number = sq.phone_number
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_temp.broadcast_excluded_recipients_temp ert
                WHERE ert.phone_number = sq.phone_number
            )
            ON CONFLICT (phone_number) DO NOTHING',
            v_segment_record.segment_id,
            v_segment_record.query,
            v_segment_record.segment_limit
        );
    END LOOP;

    SELECT COUNT(*) INTO v_current_count FROM recipients_temp;

    IF v_current_count < v_target_users THEN
        SELECT id INTO v_inactive_segment_id FROM public.audience_segments WHERE name = 'Inactive';

        EXECUTE format(
            'INSERT INTO recipients_temp (phone_number, segment_id)
            SELECT DISTINCT sq.phone_number, %s
            FROM (
                SELECT DISTINCT inner_sq.phone_number
                FROM (%s) AS inner_sq
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM pg_temp.recipients_temp rt
                    WHERE rt.phone_number = inner_sq.phone_number
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM pg_temp.broadcast_excluded_recipients_temp ert
                    WHERE ert.phone_number = inner_sq.phone_number
                )
                ORDER BY inner_sq.phone_number
                LIMIT %s
            ) AS sq
            ON CONFLICT (phone_number) DO NOTHING',
            v_inactive_segment_id,
            (SELECT query FROM public.audience_segments WHERE name = 'Inactive'),
            v_target_users - v_current_count
        );
    END IF;

    -- Queue in batches
    FOR v_offset IN 0..CEIL((SELECT COUNT(*) FROM recipients_temp)::float / v_batch_size) - 1 LOOP
        PERFORM pgmq.send_batch(
            'broadcast_first_messages',
            ARRAY(
                SELECT jsonb_build_object(
                    'recipient_phone_number', phone_number,
                    'broadcast_id', p_broadcast_id,
                    'segment_id', segment_id,
                    'first_message', v_first_message,
                    'second_message', v_second_message,
                    'delay', v_delay  -- in seconds
                )
                FROM recipients_temp
                ORDER BY phone_number
                LIMIT v_batch_size
                OFFSET v_offset * v_batch_size
            )
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
