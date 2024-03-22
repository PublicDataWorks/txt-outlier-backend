const invokeBroadcastCron = (runAt: Date): string => {
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

/**
 * @param delay in minutes
 */
const unscheduleTwilioStatus = (delay: number) => {
  const runAt = dateToCron(new Date(Date.now() + delay * 60 * 1000))
  return `
    SELECT cron.schedule(
      'delay-unschedule-twilio-status',
      '${runAt}',
      $$
        SELECT cron.unschedule('twilio-status');
        SELECT cron.unschedule('delay-unschedule-twilio-status');
      $$
    );
  `
}

const updateTwilioStatusCron = (broadcastId: number): string => {
  return `
    SELECT cron.schedule(
      'twilio-status',
      '* * * * *',
      $$
        SELECT net.http_get(
          url:='${Deno.env.get('BACKEND_URL')!}/broadcasts/twilio/${broadcastId}',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )!}"}'::jsonb
        ) as request_id;
      $$
    );
  `
}

const UNSCHEDULE_SEND_FIRST_MESSAGES = "SELECT cron.unschedule('send-first-messages');"
const UNSCHEDULE_SEND_SECOND_MESSAGES = "SELECT cron.unschedule('send-second-messages');"
const UNSCHEDULE_SEND_SECOND_INVOKE = "SELECT cron.unschedule('delay-send-second-messages');"
const SELECT_JOB_NAMES = 'SELECT jobname from cron.job;'

const JOB_NAMES = [
  'invoke-broadcast',
  'send-first-messages',
  'delay-send-second-messages',
  'delay-unschedule-twilio-status',
  'twilio-status',
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
  invokeBroadcastCron,
  JOB_NAMES,
  SELECT_JOB_NAMES,
  sendFirstMessagesCron,
  sendSecondMessagesCron,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_SEND_SECOND_INVOKE,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
  unscheduleTwilioStatus,
  updateTwilioStatusCron,
}
