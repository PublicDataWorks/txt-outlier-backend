import { and, eq, sql } from 'drizzle-orm'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { audienceSegments, Broadcast, BroadcastSegment, outgoingMessages } from '../drizzle/schema.ts'
import Sentry from '../lib/Sentry.ts'
import { escapeLiteral } from './helpers.ts'

const queueBroadcastMessages = (broadcastId: number) => {
  return `SELECT queue_broadcast_messages($$${broadcastId}$$)`
}

const pgmq_read = (queueName: string, sleepSeconds: number, n: number = 1) => {
  return sql.raw(`SELECT * FROM pgmq.read($$${queueName}$$, $$${sleepSeconds}$$, $$${n}$$);`)
}

const pgmq_send = (queueName: string, message: string, sleepSeconds: number) => {
  return sql.raw(`SELECT pgmq.send($$${queueName}$$, $$${message}$$, $$${sleepSeconds}$$)`);
}

const pgmq_delete = (queueName: string, messageId: string) => {
  return sql.raw(`SELECT pgmq.delete($$${queueName}$$, msg_id := $$${messageId}$$);`)
}

const insertOutgoingMessagesQuery = (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
  limit: number,
): string => {
  const escapedFirstMessage: string = escapeLiteral(nextBroadcast.firstMessage)
  const escapedSecondMessage = escapeLiteral(nextBroadcast.secondMessage)
  return `
    CREATE OR REPLACE FUNCTION queue_sms_messages(
      broadcast_query text,
      limit int,
      broadcast_id int,
      segment_id int,
      first_message text,
      second_message text
    ) RETURNS void as $$
        EXECUTE 'CREATE TEMPORARY TABLE recipient_phone_numbers_foo AS ' || broadcast_query || ' LIMIT ' || limit;
        SELECT pgmq.send_batch(
          'test_first',
          ARRAY(
              SELECT jsonb_build_object(
                  'recipient_phone_number', phone_number,
                  'broadcast_id', broadcast_id,
                  'segment_id', segment_id,
                  'message', first_message,
                  'is_second', false
              )
              FROM (
                  SELECT DISTINCT phone_number phone_number
                  FROM recipient_phone_numbers_foo
              ) foo
          )

    $$ LANGUAGE sql;

    CREATE TEMPORARY TABLE phone_numbers_foo AS ${broadcastSegment.segment.query} LIMIT ${limit};

    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      ${nextBroadcast.id}              AS broadcast_id,
                                      ${broadcastSegment.segment.id}   AS segment_id,
                                      ${escapedFirstMessage}           AS message,
                                      FALSE                            AS isSecond
    FROM phone_numbers_foo
    ON CONFLICT DO NOTHING;

    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      ${nextBroadcast.id}              AS broadcast_id,
                                      ${broadcastSegment.segment.id}   AS segment_id,
                                      ${escapedSecondMessage}          AS message,
                                      TRUE                             AS isSecond
    FROM phone_numbers_foo
    ON CONFLICT DO NOTHING;

    DROP TABLE phone_numbers_foo;

);
  `
}

const insertOutgoingMessagesFallbackQuery = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  nextBroadcast: Broadcast,
) => {
  const fallbackSegment = await tx
    .select()
    .from(audienceSegments)
    .where(eq(audienceSegments.name, 'Inactive'))

  if (fallbackSegment.length > 0) {
    try {
      const pendingMessageNo = await tx
        .select({
          count: sql<number>`cast
          (count(${outgoingMessages.recipientPhoneNumber}) as int)`,
        })
        .from(outgoingMessages)
        .where(and(eq(outgoingMessages.broadcastId, nextBroadcast.id!), eq(outgoingMessages.isSecond, false)))
      const limit = nextBroadcast.noUsers! - pendingMessageNo[0].count
      const escapedFirstMessage: string = escapeLiteral(nextBroadcast.firstMessage)
      const escapedSecondMessage = escapeLiteral(nextBroadcast.secondMessage)
      return `
      CREATE TEMPORARY TABLE phone_numbers_foo AS ${fallbackSegment[0].query} LIMIT ${limit};

      INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
      SELECT DISTINCT ON (phone_number) phone_number             AS recipient_phone_number,
                                        ${nextBroadcast.id}      AS broadcast_id,
                                        ${fallbackSegment[0].id} AS segment_id,
                                        ${escapedFirstMessage}   AS message,
                                        FALSE                    AS isSecond
      FROM phone_numbers_foo ON CONFLICT DO NOTHING;

      INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
      SELECT DISTINCT ON (phone_number) phone_number             AS recipient_phone_number,
                                        ${nextBroadcast.id}      AS broadcast_id,
                                        ${fallbackSegment[0].id} AS segment_id,
                                        ${escapedSecondMessage}  AS message,
                                        TRUE                     AS isSecond
      FROM phone_numbers_foo ON CONFLICT DO NOTHING;

      DROP TABLE phone_numbers_foo;
    `
    } catch (error) {
      console.error(`Error getting pending message. ${error}`)
      Sentry.captureException('Error getting pending message.')
      return
    }
  } else {
    console.error('No fallback segment found.')
    Sentry.captureException('No fallback segment found.')
    return
  }
}

const selectBroadcastDashboard = (limit: number, cursor?: number, broadcastId?: number): string => {
  let WHERE_CLAUSE = (cursor && typeof cursor === 'number') ? `WHERE b.run_at < to_timestamp(${cursor})` : 'WHERE TRUE'
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND b.id = ${broadcastId}`)
  return `
    SELECT b.id,
           b.run_at                                                                                                                   AS "runAt",
           b.delay,
           b.first_message                                                                                                            AS "firstMessage",
           b.second_message                                                                                                           AS "secondMessage",
           b.no_users                                                                                                                 AS "noUsers",
           count(bsms.id) FILTER (WHERE bsms.is_second = FALSE)                                                                       AS "totalFirstSent",
           count(bsms.id) FILTER (WHERE bsms.is_second = TRUE)                                                                        AS "totalSecondSent",
           count(bsms.id) FILTER (WHERE bsms.twilio_sent_at IS NOT NULL AND bsms.twilio_sent_status IN ('delivered', 'received'))     AS "successfullyDelivered",
           count(bsms.id) FILTER (WHERE bsms.twilio_sent_status = 'undelivered')                                                      AS "failedDelivered",
           count(distinct um.id)                                                                                                      AS "totalUnsubscribed"
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
  HANDLE_FAILED_DELIVERIES: sql.raw(`SELECT cron.unschedule('$handle-failed-deliveries');`),
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
  delay: string // 00:10:00
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
  insertOutgoingMessagesFallbackQuery,
  insertOutgoingMessagesQuery,
  pgmq_delete,
  pgmq_read,
  pgmq_send,
  queueBroadcastMessages,
  SELECT_JOB_NAMES,
  selectBroadcastDashboard,
  UNSCHEDULE_COMMANDS,
}
