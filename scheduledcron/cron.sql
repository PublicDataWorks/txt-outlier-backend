select
cron.schedule(
    'invoke-broadcast-mon-fri',
    '0 4 * * 1-5', -- every minute
$$
select
net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/<function-name>/broadcast/make',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer <serivce-role-token>"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
) as request_id;
$$
);