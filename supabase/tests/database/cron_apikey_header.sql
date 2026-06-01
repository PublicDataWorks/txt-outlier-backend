BEGIN;

-- Secrets the broadcast cron functions read from vault
SELECT vault.create_secret('test_service_key', 'secret_key');
SELECT vault.create_secret('http://edge.test/', 'edge_function_url');

-- The AFTER INSERT trigger only schedules when the job is absent; start clean
DO $$ BEGIN PERFORM cron.unschedule('send-first-messages'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT plan(3);

-- Inserting a queue row fires the trigger, which schedules send-first-messages whose
-- command does the net.http_post. cron.schedule is non-transactional, so capture the
-- command and unschedule it (before the worker can fire it), then run it ourselves so
-- the resulting request is part of this transaction and is rolled back.
DO $$
DECLARE cmd text;
BEGIN
    INSERT INTO pgmq.q_broadcast_first_messages (vt, message)
    VALUES (now(), '{"isSecond": false}'::jsonb);
    SELECT command INTO cmd FROM cron.job WHERE jobname = 'send-first-messages';
    PERFORM cron.unschedule('send-first-messages');
    EXECUTE cmd;
END $$;

SELECT is(
    (SELECT headers->>'apikey'
     FROM net.http_request_queue
     WHERE url LIKE '%edge.test%'
     ORDER BY id DESC LIMIT 1),
    'test_service_key',
    'broadcast cron authenticates the edge function with the apikey header'
);

SELECT ok(
    NOT (SELECT headers ? 'Authorization'
         FROM net.http_request_queue
         WHERE url LIKE '%edge.test%'
         ORDER BY id DESC LIMIT 1),
    'broadcast cron sends no Authorization header'
);

SELECT is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'pgmq')
          AND p.prosrc ~ 'net\.http_post'
          AND p.prosrc ~ 'Authorization'
    ),
    0,
    'no public/pgmq function calls net.http_post with an Authorization header'
);

SELECT * FROM finish();
ROLLBACK;
