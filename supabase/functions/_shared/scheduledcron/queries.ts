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
    ? `WHERE run_at < to_timestamp($$${cursor}$$)`
    : 'WHERE TRUE'
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND b.id = $$${broadcastId}$$`)
  return `
    WITH limited_broadcasts AS (
      SELECT id, run_at, delay, first_message, second_message, no_users, editable
      FROM broadcasts
      ${WHERE_CLAUSE}
      ORDER BY
          CASE WHEN editable = TRUE THEN 1 ELSE 2 END,
          run_at DESC,
          id DESC
      LIMIT ${limit}
    ),
    first_message_counts AS (
      SELECT
          broadcast_id,
          COUNT(DISTINCT recipient_phone_number) AS total_first
      FROM message_statuses
      WHERE is_second = FALSE
      AND broadcast_id IN (SELECT id FROM limited_broadcasts)
      GROUP BY broadcast_id
    ),
    second_message_counts AS (
      SELECT
          broadcast_id,
          COUNT(DISTINCT recipient_phone_number) AS total_second
      FROM message_statuses
      WHERE is_second = TRUE
      AND broadcast_id IN (SELECT id FROM limited_broadcasts)
      GROUP BY broadcast_id
    ),
    successful_deliveries AS (
      SELECT
          broadcast_id,
          COUNT(DISTINCT (recipient_phone_number, is_second)) AS total_success
      FROM message_statuses
      WHERE twilio_id IS NOT NULL
      AND twilio_sent_status IN ('delivered', 'sent')
      AND broadcast_id IN (SELECT id FROM limited_broadcasts)
      GROUP BY broadcast_id
    ),
    failed_deliveries AS (
      SELECT
          broadcast_id,
          COUNT(DISTINCT (recipient_phone_number, is_second)) AS total_failed
      FROM message_statuses
      WHERE twilio_sent_status IN ('undelivered', 'failed')
      AND broadcast_id IN (SELECT id FROM limited_broadcasts)
      GROUP BY broadcast_id
    ),
    unsubscribes AS (
      SELECT
          um.broadcast_id,
          COUNT(DISTINCT ms.recipient_phone_number) AS total_unsub
      FROM unsubscribed_messages um
      JOIN message_statuses ms ON um.reply_to = ms.id
      WHERE um.broadcast_id IN (SELECT id FROM limited_broadcasts)
      GROUP BY um.broadcast_id
    )
    SELECT
      b.id,
      b.run_at AS "runAt",
      b.delay,
      b.editable,
      b.first_message AS "firstMessage",
      b.second_message AS "secondMessage",
      b.no_users AS "noUsers",
      COALESCE(fmc.total_first, 0) AS "totalFirstSent",
      COALESCE(smc.total_second, 0) AS "totalSecondSent",
      COALESCE(sd.total_success, 0) AS "successfullyDelivered",
      COALESCE(fd.total_failed, 0) AS "failedDelivered",
      COALESCE(u.total_unsub, 0) AS "totalUnsubscribed"
    FROM limited_broadcasts b
    LEFT JOIN first_message_counts fmc ON b.id = fmc.broadcast_id
    LEFT JOIN second_message_counts smc ON b.id = smc.broadcast_id
    LEFT JOIN successful_deliveries sd ON b.id = sd.broadcast_id
    LEFT JOIN failed_deliveries fd ON b.id = fd.broadcast_id
    LEFT JOIN unsubscribes u ON b.id = u.broadcast_id
    ORDER BY
      CASE WHEN b.editable = TRUE THEN 1 ELSE 2 END,
      b.run_at DESC,
      b.id DESC;
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

const UNSCHEDULE_COMMANDS = {
  DELAY_INVOKE_BROADCAST: sql.raw(`SELECT cron.unschedule('delay-invoke-broadcast');`),
  RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('reconcile-twilio-status');`),
  DELAY_RECONCILE_TWILIO: sql.raw(`SELECT cron.unschedule('delay-reconcile-twilio-status');`),
  HANDLE_FAILED_DELIVERIES: sql.raw(`SELECT cron.unschedule('handle-failed-deliveries');`),
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
  type BroadcastDashBoardQueryReturn,
  FAILED_DELIVERED_QUERY,
  pgmqDelete,
  pgmqRead,
  pgmqSend,
  queueBroadcastMessages,
  selectBroadcastDashboard,
  UNSCHEDULE_COMMANDS,
}
