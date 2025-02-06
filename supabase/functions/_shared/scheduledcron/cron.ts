import { dateToCron } from './helpers.ts'
import { sql } from 'drizzle-orm'

const invokeBroadcastCron = (runAt: number | Date): string => {
  const runTime = dateToCron(new Date(runAt))
  return `
    SELECT cron.schedule(
      'delay-invoke-broadcast',
      '${runTime}',
      $$
        SELECT cron.schedule(
          'invoke-broadcast',
          '* * * * *',
          'SELECT net.http_get(
             url:=''${Deno.env.get('EDGE_FUNCTION_URL')!}make/'',
             headers:=''{
               "Content-Type": "application/json",
               "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
             }''::jsonb,
          ) as request_id;'
        );
      $$
    );
  `
}

/**
 * delay: number of seconds to wait before scheduling the cron
 */
const reconcileTwilioStatusCron = (broadcastId: number, delay: number) => {
  const now = Date.now()
  const runAt = dateToCron(new Date(now + delay * 1000))
  return sql.raw(`
    SELECT cron.schedule(
      'delay-reconcile-twilio-status',
      '${runAt}',
      $$
        SELECT cron.schedule(
          'reconcile-twilio-status',
          '* * * * *',
          'SELECT net.http_post(
             url:=''${Deno.env.get('EDGE_FUNCTION_URL')!}reconcile-twilio-status/'',
             body:=''{"broadcastId": "${broadcastId}", "broadcastRunAt": ${now}}''::jsonb,
             headers:=''{
               "Content-Type": "application/json",
               "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
             }''::jsonb
          ) as request_id;'
        );
      $$
    );
  `)
}

const handleFailedDeliveriesCron = () => {
  return sql.raw(`
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
}

export { handleFailedDeliveriesCron, invokeBroadcastCron, reconcileTwilioStatusCron }
