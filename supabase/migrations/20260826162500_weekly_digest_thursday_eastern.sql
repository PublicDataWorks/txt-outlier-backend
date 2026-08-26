-- Deliver the editorial briefing at 9:00 AM America/New_York every Thursday.
--
-- pg_cron schedules are UTC-only in this project. Eastern time alternates between UTC-4 and UTC-5, so the
-- job wakes at both possible UTC hours and the SQL guard invokes the function only when New York local time
-- is actually 09:00. This stays correct across daylight-saving transitions without a manual schedule change.
SELECT cron.unschedule('weekly-conversation-digest');

SELECT cron.schedule(
    'weekly-conversation-digest',
    '0 13,14 * * 4',
    $cron$
      SELECT public.trigger_weekly_conversation_digest()
      WHERE EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/New_York') = 9;
    $cron$
);
