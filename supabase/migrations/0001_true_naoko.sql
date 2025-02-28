CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('broadcast_first_messages');
SELECT pgmq.create('broadcast_second_messages');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.queue_broadcast_messages(
    p_broadcast_id int
) RETURNS void
SET search_path = ''
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
    v_sql text;
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
            FROM (
                SELECT DISTINCT phone_number
                FROM (%s) AS inner_sq
                WHERE phone_number NOT IN (SELECT phone_number FROM recipients_temp)
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
                LIMIT v_batch_size
                OFFSET v_offset * v_batch_size
            )
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
ALTER TABLE public.broadcasts
ALTER COLUMN delay DROP DEFAULT,
ALTER COLUMN delay TYPE integer USING EXTRACT(EPOCH FROM delay)::integer,
ALTER COLUMN delay SET DEFAULT 600;
--> statement-breakpoint
-- Description: Creates triggers to manage cron jobs for broadcast messages
-- Drop existing objects if they exist
DROP TRIGGER IF EXISTS trg_outlier_broadcast_messages_insert ON pgmq.q_broadcast_first_messages CASCADE;
DROP TRIGGER IF EXISTS trg_outlier_broadcast_messages_delete ON pgmq.q_broadcast_first_messages CASCADE;
DROP TRIGGER IF EXISTS trg_outlier_broadcast_second_messages_insert ON pgmq.q_broadcast_second_messages CASCADE;
DROP TRIGGER IF EXISTS trg_outlier_broadcast_second_messages_delete ON pgmq.q_broadcast_second_messages CASCADE;
DROP FUNCTION IF EXISTS pgmq.outlier_on_broadcast_first_messages_insert() CASCADE;
DROP FUNCTION IF EXISTS pgmq.outlier_on_broadcast_first_messages_delete() CASCADE;
DROP FUNCTION IF EXISTS pgmq.outlier_on_broadcast_second_messages_insert() CASCADE;
DROP FUNCTION IF EXISTS pgmq.outlier_on_broadcast_second_messages_delete() CASCADE;

-- First Messages Functions
CREATE OR REPLACE FUNCTION pgmq.outlier_on_broadcast_first_messages_insert() RETURNS TRIGGER AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
BEGIN
    -- Get both secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    IF EXISTS (SELECT 1 FROM pgmq.q_broadcast_first_messages) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM cron.job
            WHERE jobname = 'send-first-messages'
            AND schedule = '1 seconds'
        ) THEN
            PERFORM cron.schedule(
                'send-first-messages',
                '1 seconds',
                format('SELECT net.http_post(
                    url:=''%ssend-messages/'',
                    body:=''{"isSecond": false}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer %s"
                    }''::jsonb
                ) as request_id;',
                edge_url,
                service_key)
            );
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pgmq.outlier_on_broadcast_first_messages_delete() RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pgmq.q_broadcast_first_messages) THEN
            PERFORM cron.unschedule('send-first-messages');
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            NULL; -- Silently continue if check fails
    END;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Second Messages Functions
CREATE OR REPLACE FUNCTION pgmq.outlier_on_broadcast_second_messages_insert() RETURNS TRIGGER AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
BEGIN
    -- Get both secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    IF EXISTS (SELECT 1 FROM pgmq.q_broadcast_second_messages) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM cron.job
            WHERE jobname = 'send-second-messages'
            AND schedule = '1 seconds'
        ) THEN
            PERFORM cron.schedule(
                'send-second-messages',
                '1 seconds',
                format('SELECT net.http_post(
                    url:=''%s/send-messages/'',
                    body:=''{"isSecond": true}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer %s"
                    }''::jsonb
                ) as request_id;',
                edge_url,
                service_key)
            );
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pgmq.outlier_on_broadcast_second_messages_delete() RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pgmq.q_broadcast_second_messages) THEN
            PERFORM cron.unschedule('send-second-messages');
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            NULL; -- Silently continue if check fails
    END;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for first messages
CREATE TRIGGER trg_outlier_broadcast_messages_insert
AFTER INSERT ON pgmq.q_broadcast_first_messages
FOR EACH STATEMENT
EXECUTE FUNCTION pgmq.outlier_on_broadcast_first_messages_insert();

CREATE TRIGGER trg_outlier_broadcast_messages_delete
AFTER DELETE ON pgmq.q_broadcast_first_messages
FOR EACH STATEMENT
EXECUTE FUNCTION pgmq.outlier_on_broadcast_first_messages_delete();

-- Create triggers for second messages
CREATE TRIGGER trg_outlier_broadcast_second_messages_insert
AFTER INSERT ON pgmq.q_broadcast_second_messages
FOR EACH STATEMENT
EXECUTE FUNCTION pgmq.outlier_on_broadcast_second_messages_insert();

CREATE TRIGGER trg_outlier_broadcast_second_messages_delete
AFTER DELETE ON pgmq.q_broadcast_second_messages
FOR EACH STATEMENT
EXECUTE FUNCTION pgmq.outlier_on_broadcast_second_messages_delete();
