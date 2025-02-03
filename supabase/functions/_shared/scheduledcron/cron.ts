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
             url:=''${Deno.env.get('EDGE_FUNCTION_URL')!}make'',
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
          url:='${Deno.env.get('EDGE_FUNCTION_URL')!}send-messages',
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

const UNSCHEDULE_INVOKE_BROADCAST = "SELECT cron.unschedule('invoke-broadcast');"
const UNSCHEDULE_SEND_FIRST_MESSAGES = "SELECT cron.unschedule('send-first-messages');"
const UNSCHEDULE_SEND_SECOND_MESSAGES = "SELECT cron.unschedule('send-second-messages');"
const UNSCHEDULE_DELAY_SEND_SECOND_MESSAGES = "SELECT cron.unschedule('delay-send-second-messages');"
const UNSCHEDULE_RECONCILE_TWILLIO = "SELECT cron.unschedule('reconcile-twilio-status');"
const UNSCHEDULE_DELAY_RECONCILE_TWILLIO = "SELECT cron.unschedule('delay-reconcile-twilio-status');"
const UNSCHEDULE_HANDLE_FAILED_DELIVERIES = "SELECT cron.unschedule('handle-failed-deliveries');"
const SELECT_JOB_NAMES = 'SELECT jobname from cron.job;'

const JOB_NAMES = [
  'invoke-broadcast',
  'send-first-messages',
  'send-second-messages',
  'delay-send-second-messages',
  'reconcile-twilio-status',
  'delay-reconcile-twilio-status',
  'handle-failed-deliveries',
]

const dateToCron = (date: Date) => {
  const minutes = date.getMinutes()
  const hours = date.getHours()
  const days = date.getDate()
  const months = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  return `${minutes} ${hours} ${days} ${months} ${dayOfWeek}`
}

export {
  dateToCron,
  handleFailedDeliveriesCron,
  invokeBroadcastCron,
  JOB_NAMES,
  SELECT_JOB_NAMES,
  sendFirstMessagesCron,
  reconcileTwilioStatusCron,
  sendSecondMessagesCron,
  UNSCHEDULE_DELAY_RECONCILE_TWILLIO,
  UNSCHEDULE_HANDLE_FAILED_DELIVERIES,
  UNSCHEDULE_INVOKE_BROADCAST,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_RECONCILE_TWILLIO,
  UNSCHEDULE_DELAY_SEND_SECOND_MESSAGES,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
}
