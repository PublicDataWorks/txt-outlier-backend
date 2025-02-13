create table broadcast_settings
(
  id         bigint primary key generated always as identity not null,
  mon        time null,
  tue        time null,
  wed        time null,
  thu        time null,
  fri        time null,
  sat        time null,
  sun        time null,
  batch_size integer not null,
  active     boolean     default true not null,
  created_at timestamptz default now() null,
  updated_at timestamptz default now() not null
);
------------------------------------------
CREATE OR REPLACE FUNCTION schedule_cron_for_next_broadcast()
RETURNS void AS $$
DECLARE
    setting_record broadcast_settings%ROWTYPE;
    next_run_time TIMESTAMP;
    today_name TEXT;
    day_time TIME;
    service_key TEXT;
    edge_url TEXT;
    cron_expression TEXT;
    command TEXT;
BEGIN
    -- Check if job already exists
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delay-invoke-broadcast') THEN
        RETURN;
    END IF;

    -- Get the first active schedule
    SELECT * INTO setting_record
    FROM broadcast_settings
    WHERE active = true
    ORDER BY id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Get secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    -- Loop through next 7 days starting from today
    FOR i IN 0..6 LOOP
        -- Get the date we're checking
        next_run_time := CURRENT_DATE + (i * INTERVAL '1 day');

        -- Get column name for this day (mon, tue, etc)
        today_name := LOWER(TO_CHAR(next_run_time, 'Dy'));

        -- Get the scheduled time for this day
        EXECUTE format('SELECT $1.%I', today_name)
        USING setting_record
        INTO day_time;

        -- If we have a time for this day (not null)
        IF day_time IS NOT NULL THEN
            -- For today, check if time hasn't passed yet
            IF i = 0 THEN
                IF day_time > CURRENT_TIME THEN
                    next_run_time := next_run_time + day_time;
                    EXIT;
                END IF;
            ELSE
                -- For future days, use the time directly
                next_run_time := next_run_time + day_time;
                EXIT;
            END IF;
        END IF;
    END LOOP;

    -- Convert next_run_time to cron expression
    cron_expression := format(
        '%s %s %s %s %s',
        EXTRACT(MINUTE FROM next_run_time),
        EXTRACT(HOUR FROM next_run_time),
        EXTRACT(DAY FROM next_run_time),
        EXTRACT(MONTH FROM next_run_time),
        EXTRACT(DOW FROM next_run_time)::integer
    );

    -- Create the nested command
    command := format(
        'SELECT cron.schedule(
            ''invoke-broadcast'',
            ''* * * * *'',
            ''SELECT net.http_post(
                url:=''''%smake/'''',
                body:=''''{"batchSize": %s}''''::jsonb,
                headers:=''''{
                    "Content-Type": "application/json",
                    "Authorization": "Bearer %s"
                }''''::jsonb
            ) as request_id;''
        );',
        edge_url,
        setting_record.batch_size,
        service_key
    );

    -- Schedule the job if we found a valid time
    IF next_run_time IS NOT NULL THEN
        PERFORM cron.schedule(
            'delay-invoke-broadcast',
            cron_expression,
            command
        );
    END IF;
END;
$$ LANGUAGE plpgsql;
-------------------------------
 SELECT cron.schedule(
  'schedule-next-broadcast',
  '0 0 * * *',
  'SELECT schedule_cron_for_next_broadcast();'
);
