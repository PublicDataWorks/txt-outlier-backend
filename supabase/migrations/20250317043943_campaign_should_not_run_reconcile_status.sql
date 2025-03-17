CREATE OR REPLACE FUNCTION check_and_run_campaigns()
RETURNS jsonb AS $$
DECLARE
    campaign_record campaigns%ROWTYPE;
    current_timestamp_utc TIMESTAMP WITH TIME ZONE;
    campaigns_to_run INTEGER;
    campaign_ids INTEGER[];
BEGIN
    current_timestamp_utc := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
    SELECT array_agg(id), COUNT(*) INTO campaign_ids, campaigns_to_run
    FROM campaigns
    WHERE
        date_trunc('minute', run_at) = date_trunc('minute', current_timestamp_utc)
        AND processed IS FALSE;

    RAISE LOG '[check_and_run_campaigns] Checking for campaigns to run. Current time: %, Found: %',
        current_timestamp_utc, campaigns_to_run;

    IF campaigns_to_run = 0 OR campaign_ids IS NULL THEN
        RAISE WARNING '[check_and_run_campaigns] No campaigns scheduled to run at this time';
        RETURN jsonb_build_object('status', 'no_campaigns_to_run');
    END IF;

    RAISE WARNING '[check_and_run_campaigns] Found % campaigns to run. IDs: %',
        campaigns_to_run, campaign_ids;

    FOR campaign_record IN
        SELECT * FROM campaigns
        WHERE id = ANY(campaign_ids)
    LOOP
        PERFORM queue_campaign_messages(campaign_record.id);
        UPDATE campaigns
        SET processed = TRUE
        WHERE id = campaign_record.id;
        RAISE WARNING '[check_and_run_campaigns] Queued campaign ID: %', campaign_record.id;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'queued',
        'campaigns_run', campaigns_to_run,
        'campaign_ids', campaign_ids
    );
END;
$$ LANGUAGE plpgsql;
