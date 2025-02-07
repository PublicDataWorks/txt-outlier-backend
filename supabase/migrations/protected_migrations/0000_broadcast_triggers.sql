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
BEGIN
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
                'SELECT net.http_post(
                    url:=''__EDGE_URL__send-messages/'',
                    body:=''{"isSecond": false}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer __SERVICE_KEY__"
                    }''::jsonb
                ) as request_id;'
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
BEGIN
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
                'SELECT net.http_post(
                    url:=''__EDGE_URL__send-messages/'',
                    body:=''{"isSecond": true}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer __SERVICE_KEY__"
                    }''::jsonb
                ) as request_id;'
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
