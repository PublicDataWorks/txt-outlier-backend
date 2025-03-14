CREATE OR REPLACE FUNCTION public.schedule_daily_broadcast_reconciliation()
RETURNS void AS $$
DECLARE
    broadcast_record RECORD;
    campaign_record RECORD;
    service_key TEXT;
    edge_url TEXT;
    seven_days_ago TIMESTAMP WITH TIME ZONE := NOW() - INTERVAL '7 days';
    future_timestamp TIMESTAMP WITH TIME ZONE;
    cron_expression TEXT;
BEGIN
    -- Get secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    -- Process recent broadcasts (last 7 days)
    FOR broadcast_record IN (
        SELECT id, run_at
        FROM broadcasts
        WHERE run_at IS NOT NULL
        AND run_at > seven_days_ago
        ORDER BY run_at DESC
        LIMIT 3
    )
    LOOP
        -- Reset the twilio_paging field to null for this broadcast
        UPDATE broadcasts
        SET twilio_paging = NULL
        WHERE id = broadcast_record.id;

        PERFORM cron.schedule(
            'reconcile-twilio-status-broadcast-' || broadcast_record.id,
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
        future_timestamp := NOW() + INTERVAL '3 hours';
        cron_expression :=
            EXTRACT(MINUTE FROM future_timestamp) || ' ' ||
            EXTRACT(HOUR FROM future_timestamp) || ' ' ||
            EXTRACT(DAY FROM future_timestamp) || ' ' ||
            EXTRACT(MONTH FROM future_timestamp) || ' ' ||
            '*';

        PERFORM cron.schedule(
            'unschedule-broadcast-reconcile-' || broadcast_record.id,
            cron_expression,
            format('SELECT cron.unschedule(''reconcile-twilio-status-broadcast-%s''); SELECT cron.unschedule(''unschedule-broadcast-reconcile-%s'');',
                broadcast_record.id, broadcast_record.id)
        );
        RAISE NOTICE 'Scheduled reconciliation for broadcast ID: % with twilio_paging reset to NULL', broadcast_record.id;
    END LOOP;

    -- Process recent campaigns (last 7 days)
    FOR campaign_record IN (
        SELECT id, run_at
        FROM campaigns
        WHERE run_at IS NOT NULL
        AND run_at > seven_days_ago
        ORDER BY run_at DESC
        LIMIT 3
    )
    LOOP
        -- Reset the twilio_paging field to null for this campaign
        UPDATE campaigns
        SET twilio_paging = NULL
        WHERE id = campaign_record.id;

        PERFORM cron.schedule(
            'reconcile-twilio-status-campaign-' || campaign_record.id,
            '* * * * *',
            format(
                'SELECT net.http_post(
                    url:=''%s/reconcile-twilio-status/'',
                    body:=''{"campaignId": "%s"}''::jsonb,
                    headers:=''{
                        "Content-Type": "application/json",
                        "Authorization": "Bearer %s"
                    }''::jsonb
                ) as request_id;',
                edge_url,
                campaign_record.id,
                service_key
            )
        );
        future_timestamp := NOW() + INTERVAL '3 hours';
        cron_expression :=
            EXTRACT(MINUTE FROM future_timestamp) || ' ' ||
            EXTRACT(HOUR FROM future_timestamp) || ' ' ||
            EXTRACT(DAY FROM future_timestamp) || ' ' ||
            EXTRACT(MONTH FROM future_timestamp) || ' ' ||
            '*';

        PERFORM cron.schedule(
            'unschedule-campaign-reconcile-' || campaign_record.id,
            cron_expression,
            format('SELECT cron.unschedule(''reconcile-twilio-status-campaign-%s''); SELECT cron.unschedule(''unschedule-campaign-reconcile-%s'');',
                campaign_record.id, campaign_record.id)
        );
        RAISE NOTICE 'Scheduled reconciliation for campaign ID: % with twilio_paging reset to NULL', campaign_record.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run daily
SELECT cron.schedule(
    'daily-reconciliation',
    '0 20 * * *',
    'SELECT public.schedule_daily_broadcast_reconciliation();'
);
----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_daily_failed_deliveries_handler()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
    future_timestamp TIMESTAMP WITH TIME ZONE;
    cron_expression TEXT;
BEGIN
    -- Get secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    PERFORM cron.schedule(
        'handle-failed-deliveries-daily',
        '* * * * *',
        format(
            'SELECT net.http_get(
                url:=''%s/handle-failed-deliveries/'',
                headers:=''{
                    "Content-Type": "application/json",
                    "Authorization": "Bearer %s"
                }''::jsonb
            ) as request_id;',
            edge_url,
            service_key
        )
    );

    future_timestamp := NOW() + INTERVAL '3 hours';
    cron_expression :=
        EXTRACT(MINUTE FROM future_timestamp) || ' ' ||
        EXTRACT(HOUR FROM future_timestamp) || ' ' ||
        EXTRACT(DAY FROM future_timestamp) || ' ' ||
        EXTRACT(MONTH FROM future_timestamp) || ' ' ||
        '*';

    PERFORM cron.schedule(
        'unschedule-failed-deliveries-handler',
        cron_expression,
        'SELECT cron.unschedule(''handle-failed-deliveries-daily''); SELECT cron.unschedule(''unschedule-failed-deliveries-handler'');'
    );

    RAISE NOTICE 'Scheduled daily failed deliveries handler to run for the next 3 hours';
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run daily
SELECT cron.schedule(
    'daily-failed-deliveries-setup',
    '0 22 * * *',
    'SELECT public.schedule_daily_failed_deliveries_handler();'
);
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_daily_archive_double_failures()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
    future_timestamp TIMESTAMP WITH TIME ZONE;
    cron_expression TEXT;
BEGIN
    -- Get secrets from vault
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    PERFORM cron.schedule(
        'archive-double-failures-daily',
        '* * * * *',
        format(
            'SELECT net.http_post(
                url:=''%s/archive-double-failures/'',
                body:=''{}''::jsonb,
                headers:=''{
                    "Content-Type": "application/json",
                    "Authorization": "Bearer %s"
                }''::jsonb
            ) as request_id;',
            edge_url,
            service_key
        )
    );

    future_timestamp := NOW() + INTERVAL '3 hours';
    cron_expression :=
        EXTRACT(MINUTE FROM future_timestamp) || ' ' ||
        EXTRACT(HOUR FROM future_timestamp) || ' ' ||
        EXTRACT(DAY FROM future_timestamp) || ' ' ||
        EXTRACT(MONTH FROM future_timestamp) || ' ' ||
        '*';

    PERFORM cron.schedule(
        'unschedule-archive-double-failures',
        cron_expression,
        'SELECT cron.unschedule(''archive-double-failures-daily''); SELECT cron.unschedule(''unschedule-archive-double-failures'');'
    );

    RAISE NOTICE 'Scheduled daily archive double failures handler to run for the next 3 hours';
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run daily
SELECT cron.schedule(
    'daily-archive-double-failures-setup',
    '0 23 * * *',
    'SELECT public.schedule_daily_archive_double_failures();'
);
