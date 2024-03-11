import { TwilioMessage } from '../dto/BroadcastRequestResponse.ts'
import { Broadcast, BroadcastSegment } from '../drizzle/schema.ts'

const updateTwilioStatusRaw = (updatedArray: TwilioMessage[]): string => {
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
  return `
    CREATE TEMPORARY TABLE phone_numbers_foo AS ${broadcastSegment.segment.query};

    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      '${nextBroadcast.id}'            AS broadcast_id,
                                      '${broadcastSegment.segment.id}' AS segment_id,
                                      '${nextBroadcast.firstMessage}'  AS message,
                                      FALSE                            AS isSecond
    FROM phone_numbers_foo
    LIMIT ${limit};
    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      '${nextBroadcast.id}'            AS broadcast_id,
                                      '${broadcastSegment.segment.id}' AS segment_id,
                                      '${nextBroadcast.secondMessage}' AS message,
                                      TRUE                             AS isSecond
    FROM phone_numbers_foo
    LIMIT ${limit};

    DROP TABLE phone_numbers_foo;
  `
}

const selectBroadcastDashboard = (limit: number, cursor?: number, broadcastId?: number): string => {
  let WHERE_CLAUSE = cursor ? `WHERE b.run_at < to_timestamp(${cursor})` : 'WHERE TRUE'
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND b.id = ${broadcastId}`)
  return `
    SELECT b.id ,
           b.run_at                                                                                                                   AS "runAt",
           b.delay,
           b.first_message                                                                                                            AS "firstMessage",
           b.second_message                                                                                                           AS "secondMessage",
           count(bsms.id) FILTER (WHERE bsms.is_second = FALSE)                                                                       AS "totalFirstSent",
           count(bsms.id) FILTER (WHERE bsms.is_second = TRUE)                                                                        AS "totalSecondSent",
           count(bsms.id) FILTER (WHERE bsms.twilio_sent_at IS NOT NULL AND bsms.twilio_sent_status IN ('delivered', 'received'))     AS "successfullyDelivered",
           count(bsms.id) FILTER (WHERE bsms.twilio_sent_at IS NOT NULL AND bsms.twilio_sent_status NOT IN ('delivered', 'received')) AS "failedDelivered",
           count(distinct um.id)                                                                                                      AS "totalUnsubscribed"
    FROM broadcasts b
           LEFT JOIN broadcast_sent_message_status bsms ON b.id = bsms.broadcast_id
           LEFT JOIN unsubscribed_messages um ON b.id = um.broadcast_id
    ${WHERE_CLAUSE}
    GROUP BY b.id
    ORDER BY b.run_at DESC
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
  insertOutgoingMessagesQuery,
  selectBroadcastDashboard,
  updateTwilioStatusRaw,
}
