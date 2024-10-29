const invokeBroadcastCron = (runAt: number | Date): string => {
  const runTime = dateToCron(new Date(runAt))
  return `
    SELECT cron.schedule(
      'invoke-broadcast',
      '${runTime}',
      $$
        SELECT cron.unschedule('invoke-broadcast');
        SELECT net.http_get(
          url:='${Deno.env.get('BACKEND_URL')!}/broadcasts/make',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}'::jsonb) as request_id;
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
        SELECT net.http_get(
          url:='${Deno.env.get('BACKEND_URL')!}/broadcasts/draft/${broadcastId}',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}'::jsonb) as request_id;
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
          'SELECT net.http_get(
          url:=''${Deno.env.get('BACKEND_URL')!}/broadcasts/draft/${broadcastId}?isSecond=true'',
          headers:=''{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}''::jsonb) as request_id'
        );
      $$
    );
  `
}

const sendPostCron = (broadcastId: number): string => {
  const runAt = dateToCron(new Date(Date.now() + 2 * 60 * 60 * 1000))
  return `
    SELECT cron.schedule(
      'delay-send-post',
      '${runAt}',
      $$
        SELECT cron.schedule(
          'send-post-cron',
          '*/6 * * * *',
          'SELECT net.http_get(
             url:=''${Deno.env.get('BACKEND_URL')!}/broadcasts/send-post/${broadcastId}'',
             headers:=''{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}''::jsonb
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
          url:='${Deno.env.get('BACKEND_URL')!}/broadcasts/handle-failures/',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}'::jsonb
        ) as request_id;
      $$
    );
  `
}

const UNSCHEDULE_INVOKE = "SELECT cron.unschedule('invoke-broadcast');"
const UNSCHEDULE_SEND_FIRST_MESSAGES = "SELECT cron.unschedule('send-first-messages');"
const UNSCHEDULE_SEND_SECOND_MESSAGES = "SELECT cron.unschedule('send-second-messages');"
const UNSCHEDULE_SEND_SECOND_INVOKE = "SELECT cron.unschedule('delay-send-second-messages');"
const UNSCHEDULE_SEND_POST_INVOKE = "SELECT cron.unschedule('send-post-cron');"
const UNSCHEDULE_DELAY_SEND_POST = "SELECT cron.unschedule('delay-send-post');"
const UNSCHEDULE_HANDLE_FAILED_DELIVERIES = "SELECT cron.unschedule('handle-failed-deliveries');"
const SELECT_JOB_NAMES = 'SELECT jobname from cron.job;'

const JOB_NAMES = [
  'invoke-broadcast',
  'send-first-messages',
  'delay-send-second-messages',
  'delay-unschedule-twilio-status',
  'twilio-status',
  'send-post-cron',
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
  sendPostCron,
  sendSecondMessagesCron,
  UNSCHEDULE_DELAY_SEND_POST,
  UNSCHEDULE_HANDLE_FAILED_DELIVERIES,
  UNSCHEDULE_INVOKE,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_SEND_POST_INVOKE,
  UNSCHEDULE_SEND_SECOND_INVOKE,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
}
