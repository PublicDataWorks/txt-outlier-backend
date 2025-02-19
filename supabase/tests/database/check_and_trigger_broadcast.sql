BEGIN;

-- Delete existing data
DELETE FROM broadcast_settings;
DELETE FROM broadcasts;

-- Create test secrets
DO $$
BEGIN
    -- Create test secrets
    PERFORM vault.create_secret('test_key', 'service_role_key');
    PERFORM vault.create_secret('http://test.com/', 'edge_function_url');
END $$;

SELECT plan(7);

-- Test: Recent non-editable broadcast exists
INSERT INTO broadcasts (editable, run_at, first_message, second_message)
VALUES (false, CURRENT_TIMESTAMP - interval '1 hour', 'Hello', 'World');

SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'broadcast_ran_within_last_2_hours',
    'Returns broadcast_ran_within_last_2_hours when recent broadcast exists'
);
DELETE FROM broadcasts;

-- Test: No active schedule
SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'no_active_schedule',
    'Returns no_active_schedule when no settings exist'
);

-- Test: Inactive schedule
INSERT INTO broadcast_settings (mon, active)
VALUES ('10:00:00', false);

SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'no_active_schedule',
    'Returns no_active_schedule when only inactive settings exist'
);
DELETE FROM broadcast_settings;

-- Test: Active schedule at current time for today
DO $$
DECLARE
    today_column text;
    detroit_time time;
BEGIN
    today_column := LOWER(TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'America/Detroit', 'Dy'));
    detroit_time := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Detroit')::time;

    EXECUTE format('
        INSERT INTO broadcast_settings (%I, active)
        VALUES ($1, true)', today_column)
    USING detroit_time;
END $$;

SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'triggered',
    'Returns current UTC timestamp when schedule matches'
);
DELETE FROM broadcast_settings;

-- Test: Editable broadcast with future run_at
INSERT INTO broadcasts (editable, run_at, first_message, second_message)
VALUES (true, CURRENT_TIMESTAMP + interval '1 hour', 'Hello', 'World');
SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'paused_schedule_not_match_current_time',
    'Returns paused_schedule_not_match_current_time when run_at is in future'
);
DELETE FROM broadcasts;
-- Test: Editable broadcast with matching run_at
INSERT INTO broadcasts (editable, run_at, first_message, second_message)
VALUES (true, date_trunc('minute', CURRENT_TIMESTAMP), 'Hello', 'World');

SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'triggered',
    'Returns triggered when editable broadcast matches current time'
);
DELETE FROM broadcasts;
-- Test: Active schedule at current time (should not trigger because editable broadcast exists)
INSERT INTO broadcasts (editable, run_at, first_message, second_message)
VALUES (true, CURRENT_TIMESTAMP + interval '1 hour', 'Hello', 'World');
DO $$
DECLARE
    today_column text;
    detroit_time time;
BEGIN
    today_column := LOWER(TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'America/Detroit', 'Dy'));
    detroit_time := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Detroit')::time;

    EXECUTE format('
        INSERT INTO broadcast_settings (%I, active)
        VALUES ($1, true)', today_column)
    USING detroit_time;
END $$;

SELECT is(
    (SELECT check_and_trigger_broadcast()->>'status'),
    'paused_schedule_not_match_current_time',
    'Returns paused_schedule_not_match_current_time even with matching schedule'
);
-- Clean up
SELECT * FROM finish();
ROLLBACK;
