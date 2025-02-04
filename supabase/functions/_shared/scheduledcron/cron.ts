import { dateToCron } from './helpers.ts'

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

const sendFirstMessagesCron = (broadcastId: number): string => {
  return `
    SELECT cron.schedule(
      'send-first-messages',
      '* * * * *',
      $$
        SELECT net.http_post(
          url:='${Deno.env.get('EDGE_FUNCTION_URL')!}send-messages/',
          body:='{"broadcastId": "${broadcastId}", "isSecond": false}'::jsonb,
          headers:='{
            "Content-Type": "application/json",
            "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
          }'::jsonb
        ) as request_id;
      $$
    );
  `
}

/**
 * @param startTime run time of the last sent first message
 * @param broadcastId
 * @param delay in minutes
 */
const sendSecondMessagesCron = (startTime: number, broadcastId: number, delay: number) => {
  const startTimeInDate = new Date(startTime)
  const runAt = dateToCron(new Date(startTimeInDate.getTime() + delay * 60 * 1000))

  return `
    SELECT cron.schedule(
      'delay-send-second-messages',
      '${runAt}',
      $$
        SELECT cron.schedule(
          'send-second-messages',
          '* * * * *',
          'SELECT net.http_post(
            url:=''${Deno.env.get('EDGE_FUNCTION_URL')!}send-messages/'',
            body:=''{"broadcastId": "${broadcastId}", "isSecond": true}''::jsonb,
            headers:=''{
              "Content-Type": "application/json",
              "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
            }''::jsonb
          ) as request_id'
        );
      $$
    );
  `
}

const reconcileTwilioStatusCron = (broadcastId: number): string => {
  const runAt = dateToCron(new Date(Date.now() + 2 * 60 * 60 * 1000))
  return `
    SELECT cron.schedule(
      'delay-reconcile-twilio-status',
      '${runAt}',
      $$
        SELECT cron.schedule(
          'reconcile-twilio-status',
          '*/6 * * * *',
          'SELECT net.http_post(
             url:=''${Deno.env.get('EDGE_FUNCTION_URL')!}reconcile-twilio-status/'',
             body:=''{"broadcastId": "${broadcastId}"}''::jsonb,
             headers:=''{
               "Content-Type": "application/json",
               "Authorization": "Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}"
             }''::jsonb
          ) as request_id;'
        );
      $$
    );
  `
}

const handleFailedDeliveriesCron = (): string => {
  return `
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
  `
}

export {
  handleFailedDeliveriesCron,
  invokeBroadcastCron,
  reconcileTwilioStatusCron,
  sendFirstMessagesCron,
  sendSecondMessagesCron,
}
