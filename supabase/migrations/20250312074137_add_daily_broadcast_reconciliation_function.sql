CREATE OR REPLACE FUNCTION public.schedule_daily_broadcast_reconciliation()
RETURNS void AS $$
DECLARE
    broadcast_record RECORD;
    service_key TEXT;
    edge_url TEXT;
BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    FOR broadcast_record IN (
        SELECT id, run_at
        FROM broadcasts
        WHERE run_at IS NOT NULL
        ORDER BY run_at DESC
        LIMIT 3
    )
    LOOP
        -- Reset the twilio_paging field to null for this broadcast
        UPDATE broadcasts
        SET twilio_paging = NULL
        WHERE id = broadcast_record.id;

        PERFORM cron.schedule(
            'reconcile-twilio-status-' || broadcast_record.id,
            '* * * * *',
            format(
                'SELECT net.http_post(
                    url:=''%s/reconcile-twilio-status/'',
                    body:=''{"broadcastId": "%s"}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer %s"
                    }''::jsonb
                ) as request_id;',
                edge_url,
                broadcast_record.id,
                service_key
            )
        );

        RAISE NOTICE 'Scheduled reconciliation for broadcast ID: % with twilio_paging reset to NULL', broadcast_record.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run daily at 2:00 AM UTC
SELECT cron.schedule(
    'daily-broadcast-reconciliation',
    '0 2 * * *',
    'SELECT public.schedule_daily_broadcast_reconciliation();'
);
