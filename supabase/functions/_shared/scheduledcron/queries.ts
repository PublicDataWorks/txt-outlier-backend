import { sql } from 'drizzle-orm'

const queueBroadcastMessages = (broadcastId: number) => {
  return sql.raw(`SELECT queue_broadcast_messages($$${broadcastId}$$)`)
}

const pgmq_read = (queueName: string, sleepSeconds: number, n: number = 1) => {
  return sql.raw(`SELECT * FROM pgmq.read($$${queueName}$$, $$${sleepSeconds}$$, $$${n}$$);`)
}

const pgmq_send = (queueName: string, message: string, sleepSeconds: number) => {
  return sql.raw(`SELECT pgmq.send($$${queueName}$$, $$${message}$$, $$${sleepSeconds}$$)`)
}

const pgmq_delete = (queueName: string, messageId: string) => {
  return sql.raw(`SELECT pgmq.delete($$${queueName}$$, msg_id := $$${messageId}$$);`)
}

const selectBroadcastDashboard = (limit: number, cursor?: number, broadcastId?: number): string => {
  let WHERE_CLAUSE = (cursor && typeof cursor === 'number')
    ? `WHERE b.run_at < to_timestamp($$${cursor}$$)`
    : 'WHERE TRUE'
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND b.id = $$${broadcastId}$$`)
  return `
    SELECT b.id,
           b.run_at                                                                                                                                                         AS "runAt",
           b.delay,
           b.first_message                                                                                                                                                  AS "firstMessage",
           b.second_message                                                                                                                                                 AS "secondMessage",
           b.no_users                                                                                                                                                       AS "noUsers",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE bsms.is_second = FALSE)                                                                                AS "totalFirstSent",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE bsms.is_second = TRUE)                                                                                 AS "totalSecondSent",
           count(distinct (bsms.recipient_phone_number, bsms.is_second)) FILTER (WHERE bsms.twilio_id IS NOT NULL AND bsms.twilio_sent_status IN ('delivered', 'sent'))     AS "successfullyDelivered",
           count(distinct (bsms.recipient_phone_number, bsms.is_second)) FILTER (WHERE bsms.twilio_sent_status IN ('undelivered', 'failed'))                                AS "failedDelivered",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE um.id IS NOT NULL)                                                                                     AS "totalUnsubscribed"
    FROM broadcasts b
           LEFT JOIN broadcast_sent_message_status bsms ON b.id = bsms.broadcast_id
           LEFT JOIN unsubscribed_messages um ON b.id = um.broadcast_id AND um.reply_to = bsms.id
      ${WHERE_CLAUSE}
    GROUP BY b.id
    ORDER BY
        CASE WHEN editable = TRUE THEN 1 ELSE 2 END,
        b.run_at DESC,
        b.id DESC
    LIMIT ${limit}
  `
}

const FAILED_DELIVERED_QUERY = `
  WITH RankedMessages AS (
    SELECT
        twilio_sent_status,
        recipient_phone_number,
        missive_conversation_id,
        ROW_NUMBER() OVER (
            PARTITION BY recipient_phone_number
            ORDER BY id DESC
        ) as rn
    FROM broadcast_sent_message_status
  )
  SELECT
    r.recipient_phone_number as phone_number,
    (array_agg(r.missive_conversation_id))[1] as missive_conversation_id
  FROM RankedMessages r
  JOIN authors a ON a.phone_number = r.recipient_phone_number
  WHERE r.rn <= 3
    AND a.exclude = FALSE
  GROUP BY r.recipient_phone_number
  HAVING COUNT(*) = 3
    AND SUM(CASE WHEN r.twilio_sent_status = 'delivered' THEN 1 ELSE 0 END) = 0
  LIMIT 330;
`

const UNSCHEDULE_COMMANDS = {
  INVOKE_BROADCAST: sql.raw(`SELECT cron.unschedule('invoke-broadcast');`),
  RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('reconcile-twilio-status');`),
  DELAY_RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('delay-reconcile-twilio-status');`),
  HANDLE_FAILED_DELIVERIES: sql.raw(`SELECT cron.unschedule('handle-failed-deliveries');`),
} as const

const SELECT_JOB_NAMES = 'SELECT jobname from cron.job;'

const BROADCAST_RUNNING_INDICATORS: string[] = [
  'send-first-messages',
  'send-second-messages',
  'delay-reconcile-twilio-status',
  'reconcile-twilio-status',
]

interface BroadcastDashBoardQueryReturn {
  id: number
  runAt: Date
  delay: number
  firstMessage: string
  secondMessage: string
  totalFirstSent: string
  totalSecondSent: string
  successfullyDelivered: string
  failedDelivered: string
  totalUnsubscribed: string
}

export {
  BROADCAST_RUNNING_INDICATORS,
  type BroadcastDashBoardQueryReturn,
  FAILED_DELIVERED_QUERY,
  pgmq_delete,
  pgmq_read,
  pgmq_send,
  queueBroadcastMessages,
  SELECT_JOB_NAMES,
  selectBroadcastDashboard,
  UNSCHEDULE_COMMANDS,
}
