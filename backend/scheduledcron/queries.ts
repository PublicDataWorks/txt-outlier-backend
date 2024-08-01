import { audienceSegments, Broadcast, BroadcastSegment, outgoingMessages } from '../drizzle/schema.ts'
import { escapeLiteral } from './helpers.ts'
import { eq, sql } from 'drizzle-orm'
import supabase from '../lib/supabase.ts'
import * as log from 'log'
import * as DenoSentry from 'sentry/deno'

const updateTwilioStatusRaw = (updatedArray: string[]): string => {
  // updatedArray is already escaped
  return `
    WITH new_values (twilio_sent_status, twilio_id, twilio_sent_at, recipient_phone_number, broadcast_id, body)
           AS (VALUES ${updatedArray.join(',')})
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

const insertOutgoingMessagesQuery = (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
  limit: number,
): string => {
  const escapedFirstMessage: string = escapeLiteral(nextBroadcast.firstMessage)
  const escapedSecondMessage = escapeLiteral(nextBroadcast.secondMessage)
  return `
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
  `
}

const insertOutgoingMessagesFallbackQuery = async (
  nextBroadcast: Broadcast,
) => {
  const fallbackSegment = await supabase
    .select()
    .from(audienceSegments)
    .where(eq(audienceSegments.name, 'Inactive'))

  if (fallbackSegment.length > 0) {
    try {
      const pendingMessageNo = await supabase
        .select({
          count: sql<number>`cast
          (count(${outgoingMessages.id}) as int)`,
        })
        .from(outgoingMessages)
        .where(eq(outgoingMessages.broadcastId, nextBroadcast.id!))
      const limit = nextBroadcast.noUsers! - pendingMessageNo[0].count
      const escapedFirstMessage: string = escapeLiteral(nextBroadcast.firstMessage)
      const escapedSecondMessage = escapeLiteral(nextBroadcast.secondMessage)
      return `
      CREATE TEMPORARY TABLE phone_numbers_foo AS ${fallbackSegment[0].query} LIMIT {$limit};

      INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
      SELECT DISTINCT ON (phone_number) phone_number             AS recipient_phone_number,
                                        ${nextBroadcast.id}      AS broadcast_id,
                                        ${fallbackSegment[0].id} AS segment_id,
                                        ${escapedFirstMessage}   AS message,
                                        FALSE                    AS isSecond
      FROM phone_numbers_foo

      ON CONFLICT DO NOTHING;

      INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
      SELECT DISTINCT ON (phone_number) phone_number             AS recipient_phone_number,
                                        ${nextBroadcast.id}      AS broadcast_id,
                                        ${fallbackSegment[0].id} AS segment_id,
                                        ${escapedSecondMessage}  AS message,
                                        TRUE                     AS isSecond
      FROM phone_numbers_foo
      LIMIT ${limit}
      ON CONFLICT DO NOTHING;

      DROP TABLE phone_numbers_foo;
    `
    } catch (error) {
      log.error(`Error getting pending message. ${error}`)
      DenoSentry.captureException('Error getting pending message.')
      return
    }
  } else {
    log.error('No fallback segment found.')
    DenoSentry.captureException('No fallback segment found.')
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
           count(bsms.id) FILTER (WHERE bsms.twilio_sent_at IS NOT NULL AND bsms.twilio_sent_status NOT IN ('delivered', 'received')) AS "failedDelivered",
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
  type BroadcastDashBoardQueryReturn,
  insertOutgoingMessagesFallbackQuery,
  insertOutgoingMessagesQuery,
  selectBroadcastDashboard,
  updateTwilioStatusRaw,
}
