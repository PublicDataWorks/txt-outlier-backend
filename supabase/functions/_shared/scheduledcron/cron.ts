import { sql } from 'drizzle-orm'

const HANDLE_FAILED_DELIVERIES_CRON = sql.raw(`
    SELECT cron.schedule(
      'handle-failed-deliveries',
      '*/6 * * * *',
      $$
        SELECT net.http_get(
          url:='${Deno.env.get('EDGE_FUNCTION_URL')!}handle-failed-deliveries/',
          headers:='{
            "Content-Type": "application/json",
            "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
          }'::jsonb
        ) as request_id;
      $$
    );
 `)

const ARCHIVE_BROADCAST_DOUBLE_FAILURES_CRON = sql.raw(`
    SELECT cron.schedule(
      'archive-broadcast-double-failures',
      '* * * * *',
      $$
        SELECT net.http_post(
          url:='${Deno.env.get('EDGE_FUNCTION_URL')!}archive-double-failures/',
          headers:='{
            "Content-Type": "application/json",
            "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
          }'::jsonb
        ) as request_id;
      $$
    );
`)

export { ARCHIVE_BROADCAST_DOUBLE_FAILURES_CRON, HANDLE_FAILED_DELIVERIES_CRON }
