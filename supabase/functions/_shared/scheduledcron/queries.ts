import { sql } from 'drizzle-orm'

const queueBroadcastMessages = (broadcastId: number) => {
  return sql.raw(`SELECT queue_broadcast_messages($$${broadcastId}$$)`)
}

const pgmqRead = (queueName: string, sleepSeconds: number, n: number = 1) => {
  return sql.raw(`SELECT * FROM pgmq.read($$${queueName}$$, $$${sleepSeconds}$$, $$${n}$$);`)
}

const pgmqSend = (queueName: string, message: string, sleepSeconds: number) => {
  return sql.raw(`SELECT pgmq.send($$${queueName}$$, $$${message}$$, $$${sleepSeconds}$$)`)
}

const pgmqDelete = (queueName: string, messageId: string) => {
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
           b.editable,
		       b.first_message                                                                                                                                                  AS "firstMessage",
           b.second_message                                                                                                                                                 AS "secondMessage",
           b.no_users                                                                                                                                                       AS "noUsers",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE bsms.is_second = FALSE)                                                                                AS "totalFirstSent",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE bsms.is_second = TRUE)                                                                                 AS "totalSecondSent",
           count(distinct (bsms.recipient_phone_number, bsms.is_second)) FILTER (WHERE bsms.twilio_id IS NOT NULL AND bsms.twilio_sent_status IN ('delivered', 'sent'))     AS "successfullyDelivered",
           count(distinct (bsms.recipient_phone_number, bsms.is_second)) FILTER (WHERE bsms.twilio_sent_status IN ('undelivered', 'failed'))                                AS "failedDelivered",
           count(distinct bsms.recipient_phone_number) FILTER (WHERE um.id IS NOT NULL)                                                                                     AS "totalUnsubscribed"
    FROM broadcasts b
           LEFT JOIN message_statuses bsms ON b.id = bsms.broadcast_id
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
    FROM message_statuses
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

const BROADCAST_DOUBLE_FAILURE_QUERY = sql.raw(`
  WITH LatestBroadcast AS (
    SELECT id
    FROM broadcasts
    WHERE editable = false
    ORDER BY run_at DESC
    LIMIT 1
  )
  SELECT
    bsms.recipient_phone_number,
    bsms.missive_conversation_id
  FROM message_statuses bsms
  JOIN LatestBroadcast lb ON bsms.broadcast_id = lb.id
  JOIN conversations c ON bsms.missive_conversation_id = c.id
  WHERE
    (c.shared_label_names IS NULL OR c.shared_label_names NOT ILIKE '%archive%')
  GROUP BY bsms.recipient_phone_number, bsms.missive_conversation_id
  HAVING
    COUNT(*) = 2
    AND SUM(CASE WHEN bsms.twilio_sent_status IN ('undelivered', 'failed') THEN 1 ELSE 0 END) = 2
  LIMIT 40;
`)

const UNSCHEDULE_COMMANDS = {
  DELAY_INVOKE_BROADCAST: sql.raw(`SELECT cron.unschedule('delay-invoke-broadcast');`),
  RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('reconcile-twilio-status');`),
  DELAY_RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('delay-reconcile-twilio-status');`),
  HANDLE_FAILED_DELIVERIES: sql.raw(`SELECT cron.unschedule('handle-failed-deliveries');`),
  ARCHIVE_BROADCAST_DOUBLE_FAILURES: sql.raw(`SELECT cron.unschedule('archive-broadcast-double-failures');`),
} as const

interface BroadcastDashBoardQueryReturn {
  id: number
  runAt: Date
  delay: number
  editable: boolean
  firstMessage: string
  secondMessage: string
  totalFirstSent: string
  totalSecondSent: string
  successfullyDelivered: string
  failedDelivered: string
  totalUnsubscribed: string
}

export {
  BROADCAST_DOUBLE_FAILURE_QUERY,
  type BroadcastDashBoardQueryReturn,
  FAILED_DELIVERED_QUERY,
  pgmqDelete,
  pgmqRead,
  pgmqSend,
  queueBroadcastMessages,
  selectBroadcastDashboard,
  UNSCHEDULE_COMMANDS,
}
