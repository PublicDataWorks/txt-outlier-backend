import { Broadcast, BroadcastSegment } from '../drizzle/schema.ts'
import { TwilioMessage } from '../dto/BroadcastRequestResponse.ts'

const invokeBroadcastCron = (runAt: Date): string => {
  const runTime = dateToCron(new Date(runAt))
  return `
    SELECT cron.schedule(
      'invoke-broadcast',
      '${runTime}',
      $$
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

const insertOutgoingMessagesQuery = (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
  message: string,
  limit: number,
): string => {
  return `
    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                                 AS recipient_phone_number,
                                      '${nextBroadcast.id}'                        AS broadcast_id,
                                      '${broadcastSegment.segment.id}'             AS segment_id,
                                      '${message}'                                 AS message,
                                      '${message === nextBroadcast.secondMessage}' AS isSecond
    FROM (${broadcastSegment.segment.query}) AS foo
    LIMIT ${limit}
  `
}

const updateTwilioStatusRaw = (updatedArray: TwilioMessage[]): string => {
  return `
    WITH new_values (twilio_sent_status, twilio_id, twilio_sent_at, recipient_phone_number, broadcast_id, body)
           AS (VALUES
                 ${updatedArray.join(',')})
    UPDATE broadcast_sent_message_status
    SET twilio_sent_status = new_values.twilio_sent_status,
        twilio_id          = new_values.twilio_id,
        twilio_sent_at     = new_values.twilio_sent_at
    FROM new_values
    WHERE broadcast_sent_message_status.recipient_phone_number = new_values.recipient_phone_number
      AND broadcast_sent_message_status.broadcast_id = new_values.broadcast_id
      AND broadcast_sent_message_status.message = new_values.body;
  `
}

const UNSCHEDULE_SEND_FIRST_MESSAGES = "SELECT cron.unschedule('send-first-messages');"
const UNSCHEDULE_SEND_SECOND_MESSAGES = "SELECT cron.unschedule('send-second-messages');"
const UNSCHEDULE_SEND_SECOND_INVOKE = "SELECT cron.unschedule('delay-send-second-messages');"

const dateToCron = (date: Date) => {
  const minutes = date.getMinutes()
  const hours = date.getHours()
  const days = date.getDate()
  const months = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  return `${minutes} ${hours} ${days} ${months} ${dayOfWeek}`
}

export {
  insertOutgoingMessagesQuery,
  invokeBroadcastCron,
  sendFirstMessagesCron,
  sendSecondMessagesCron,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_SEND_SECOND_INVOKE,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
  unscheduleTwilioStatus,
  updateTwilioStatusCron,
  updateTwilioStatusRaw,
}
