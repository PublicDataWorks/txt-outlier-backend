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
  active     boolean     default true not null,
  created_at timestamptz default now() null,
  updated_at timestamptz default now() not null
);

-------------------------------

CREATE OR REPLACE FUNCTION trigger_broadcast_api()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
    request_id TEXT;
    run_at_utc TEXT;
BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    run_at_utc := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');

    PERFORM net.http_post(
        url:=edge_url || 'make/',
        headers:=jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_key
        ),
        body:=jsonb_build_object('run_at_utc', run_at_utc)
    );
END;
$$ LANGUAGE plpgsql;

-------------------------------

CREATE OR REPLACE FUNCTION check_and_trigger_broadcast()
RETURNS jsonb AS $$
DECLARE
    setting_record broadcast_settings%ROWTYPE;
    broadcast_record broadcasts%ROWTYPE;
    detroit_current_timestamp TIMESTAMP WITH TIME ZONE;
    detroit_current_time TIME;
    detroit_date_name TEXT;
    todays_scheduled_time TIME;
    run_at_utc TEXT;
BEGIN
    SELECT * INTO broadcast_record
    FROM public.broadcasts
    WHERE editable = false
    AND run_at > CURRENT_TIMESTAMP - interval '2 hours'
    ORDER BY run_at DESC
    LIMIT 1;

    IF FOUND THEN
        RAISE WARNING '[check_and_trigger_broadcast] Broadcast ran within last 2 hours. ID: %, run_at: %',
            broadcast_record.id, broadcast_record.run_at;
        RETURN jsonb_build_object('status', 'broadcast_ran_within_last_2_hours');
    END IF;

    SELECT * INTO broadcast_record
    FROM public.broadcasts
    WHERE editable = true
    AND run_at IS NOT NULL
    ORDER BY id DESC
    LIMIT 1;

    IF FOUND THEN
        IF date_trunc('minute', CURRENT_TIMESTAMP) = date_trunc('minute', broadcast_record.run_at) THEN
            PERFORM trigger_broadcast_api();
            RAISE WARNING '[check_and_trigger_broadcast] Triggerred paused broadcast. ID: %', broadcast_record.id;
            RETURN jsonb_build_object('status', 'triggered');
        END IF;
        RAISE WARNING '[check_and_trigger_broadcast] Paused broadcast time not matched. run_at: %',
            broadcast_record.run_at;
        RETURN jsonb_build_object('status', 'paused_schedule_not_match_current_time');
    END IF;

    -- If no editable record with matching run_at, proceed with normal schedule
    detroit_current_timestamp := CURRENT_TIMESTAMP AT TIME ZONE 'America/Detroit';
    detroit_current_time := detroit_current_timestamp::time;
    detroit_date_name := LOWER(TO_CHAR(detroit_current_timestamp, 'Dy'));

    RAISE LOG '[check_and_trigger_broadcast] Checking regular schedule. Detroit time: %, day: %',
        detroit_current_time, detroit_date_name;

    SELECT * INTO setting_record
    FROM broadcast_settings
    WHERE active = true
    ORDER BY id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE WARNING '[check_and_trigger_broadcast] No active broadcast settings found';
        RETURN jsonb_build_object('status', 'no_active_schedule');
    END IF;

    -- Get today's scheduled time based on Detroit's date
    EXECUTE format('SELECT $1.%I', detroit_date_name)
    USING setting_record
    INTO todays_scheduled_time;

    RAISE LOG '[check_and_trigger_broadcast] Regular schedule check. Scheduled time: %, current time: %',
        todays_scheduled_time, detroit_current_time;

    -- Check if current time matches scheduled time
    IF todays_scheduled_time IS NOT NULL AND
       date_trunc('minute', detroit_current_time::interval) = date_trunc('minute', todays_scheduled_time::interval) THEN
        PERFORM trigger_broadcast_api();
        RAISE WARNING '[check_and_trigger_broadcast] Triggered regular schedule broadcast';
        RETURN jsonb_build_object('status', 'triggered');
    END IF;

    RAISE WARNING '[check_and_trigger_broadcast] No schedule match found';
    RETURN jsonb_build_object('status', 'no_schedule_match');
END;
$$ LANGUAGE plpgsql;

-------------------------------

 SELECT cron.schedule(
  'check-and-trigger-broadcast-every-minute',
  '* * * * *',
  'SELECT check_and_trigger_broadcast();'
);

-------------------------------
ALTER TABLE public.broadcasts ALTER COLUMN "run_at" DROP NOT NULL;
