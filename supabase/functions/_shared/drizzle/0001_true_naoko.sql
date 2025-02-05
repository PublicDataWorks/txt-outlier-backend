CREATE EXTENSION IF NOT EXISTS cron;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgmq;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_broadcast_messages(
    p_broadcast_id int
) RETURNS void
SET search_path = ''
AS $$
DECLARE
    v_first_message text;
    v_second_message text;
    v_segment_record RECORD;
    v_offset int;
    v_target_users int;
    v_batch_size constant int := 100;
    v_current_count int;
    v_inactive_segment_id int;
    v_sql text;
BEGIN
    -- Get broadcast info
    SELECT
        first_message,
        second_message,
        no_users INTO
        v_first_message,
        v_second_message,
        v_target_users
    FROM public.broadcasts
    WHERE id = p_broadcast_id;

    CREATE TEMPORARY TABLE recipients_temp (
        phone_number text PRIMARY KEY,
        segment_id int
    );

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
            SELECT DISTINCT phone_number, %s as segment_id
            FROM (%s LIMIT %s) AS sq
            WHERE phone_number NOT IN (SELECT phone_number FROM recipients_temp)
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
            SELECT DISTINCT phone_number, %s
            FROM (%s LIMIT %s) AS sq
            WHERE phone_number NOT IN (SELECT phone_number FROM recipients_temp)
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
                    'message', v_first_message
                )
                FROM recipients_temp
                LIMIT v_batch_size
                OFFSET v_offset * v_batch_size
            )
        );

        PERFORM pgmq.send_batch(
            'broadcast_second_messages',
            ARRAY(
                SELECT jsonb_build_object(
                    'recipient_phone_number', phone_number,
                    'broadcast_id', p_broadcast_id,
                    'segment_id', segment_id,
                    'message', v_second_message
                )
                FROM recipients_temp
                LIMIT v_batch_size
                OFFSET v_offset * v_batch_size
            )
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
ALTER TABLE broadcasts
ALTER COLUMN delay DROP DEFAULT,
ALTER COLUMN delay TYPE integer USING EXTRACT(EPOCH FROM delay)::integer,
ALTER COLUMN delay SET DEFAULT 600;
