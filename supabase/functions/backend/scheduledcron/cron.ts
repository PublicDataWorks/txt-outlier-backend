import { Broadcast, BroadcastSegment } from '../drizzle/schema.ts'

const invokeBroadcastCron = (runAt: Date): string => {
	const runTime = dateToCron(new Date(runAt))
	return `
    SELECT cron.schedule(
      'invoke-broadcast',
      '${runTime}',
      $$
      SELECT net.http_get(
        url:='${Deno.env.get('BACKEND_URL')!}/broadcast/make',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
		'SUPABASE_SERVICE_ROLE_KEY',
	)!}"}'::jsonb
      ) as request_id;
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
	)!}"}'::jsonb
      ) as request_id;
      $$
    );
  `
}

const sendSecondMessagesCron = (startTime: number, broadcastId: number, delay: number) => {
	const date = new Date(startTime)
	const newDate = new Date(date.getTime() + delay * 60 * 1000)
	const runTime = dateToCron(newDate)

	return `
    SELECT cron.schedule(
             'delay-send-second-messages',
             '${runTime}',
             $$
      DELETE FROM outgoing_messages o
        WHERE
          o.broadcast_id = ${broadcastId}
          AND o.is_second = true
          AND o.recipient_phone_number IN (
            SELECT t.from_field
            FROM twilio_messages t
            WHERE t.delivered_at >= '${date.toISOString()}' AND t.delivered_at <= now()
          );
      SELECT cron.schedule(
        'send-second-messages',
        '* * * * *',
        'SELECT net.http_get(
          url:=''${Deno.env.get('BACKEND_URL')!}/broadcasts/draft/${broadcastId}?isSecond=true'',
          headers:=''{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
		'SUPABASE_SERVICE_ROLE_KEY',
	)!}"}''::jsonb
        ) as request_id'
      );
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
    SELECT DISTINCT ON (phone_number) phone_number                                            AS recipient_phone_number,
                                      '${nextBroadcast.id}'                                   AS broadcast_id,
                                      '${broadcastSegment.segment.id}'                        AS segment_id,
                                      '${message}'                                            AS message,
                                      '${message === nextBroadcast.secondMessage}' AS isSecond
    FROM (${broadcastSegment.segment.query}) AS foo
    LIMIT ${limit}
  `
}

const UNSCHEDULE_SEND_FIRST_MESSAGES = `SELECT cron.unschedule('send-first-messages');`
const UNSCHEDULE_SEND_SECOND_MESSAGES = `SELECT cron.unschedule('send-second-messages');`
const UNSCHEDULE_INVOKE_BROADCAST = `SELECT cron.unschedule('invoke-broadcast');`

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
	UNSCHEDULE_INVOKE_BROADCAST,
	UNSCHEDULE_SEND_FIRST_MESSAGES,
	UNSCHEDULE_SEND_SECOND_MESSAGES,
}
