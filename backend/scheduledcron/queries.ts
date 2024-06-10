import { Broadcast, BroadcastSegment } from '../drizzle/schema.ts'
import { escapeLiteral } from './helpers.ts'
import { IMPACT_LABEL_IDS, REPORTER_LABEL_IDS } from '../constants/labels.ts'

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
    CREATE TEMPORARY TABLE phone_numbers_foo AS ${broadcastSegment.segment.query};

    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      ${nextBroadcast.id}              AS broadcast_id,
                                      ${broadcastSegment.segment.id}   AS segment_id,
                                      ${escapedFirstMessage}           AS message,
                                      FALSE                            AS isSecond
    FROM phone_numbers_foo
    LIMIT ${limit}
    ON CONFLICT DO NOTHING;

    INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
    SELECT DISTINCT ON (phone_number) phone_number                     AS recipient_phone_number,
                                      ${nextBroadcast.id}              AS broadcast_id,
                                      ${broadcastSegment.segment.id}   AS segment_id,
                                      ${escapedSecondMessage}          AS message,
                                      TRUE                             AS isSecond
    FROM phone_numbers_foo
    LIMIT ${limit}
    ON CONFLICT DO NOTHING;

    DROP TABLE phone_numbers_foo;
  `
}

const selectBroadcastDashboard = (limit: number, cursor?: number, broadcastId?: number): string => {
  let WHERE_CLAUSE = (cursor && typeof cursor === 'number') ? `WHERE b.run_at < to_timestamp(${cursor})` : 'WHERE TRUE'
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND b.id = ${broadcastId}`)
  return `
    SELECT b.id ,
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
           LEFT JOIN unsubscribed_messages um ON b.id = um.broadcast_id
    ${WHERE_CLAUSE}
    GROUP BY b.id
    ORDER BY
        CASE WHEN editable = TRUE THEN 1 ELSE 2 END,
        b.run_at DESC,
        b.id DESC
    LIMIT ${limit}
  `
}

const selectWeeklyUnsubcribeBroadcastMessageStatus = `
  SELECT 
  bsms.audience_segment_id,
  asg.name,
  COUNT(*) AS count  -- Example aggregation: count of unsubscribed messages
  FROM 
    public.unsubscribed_messages um 
  LEFT JOIN 
    public.broadcast_sent_message_status bsms 
  ON 
    um.reply_to = bsms.id
  LEFT JOIN public.audience_segments asg 
  ON bsms.audience_segment_id = asg.id
  WHERE
  um.created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  um.created_at < DATE_TRUNC('week', CURRENT_DATE) 
  GROUP BY bsms.audience_segment_id, asg.name
  `

const selectWeeklyBroadcastSent = `
  SELECT COUNT(*) AS count
  FROM public.broadcast_sent_message_status
  WHERE 
  is_second = False
  AND
  created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  created_at < DATE_TRUNC('week', CURRENT_DATE) 
`

const selectWeeklyFailedMessage = `
  SELECT COUNT(*) AS count
  FROM public.broadcast_sent_message_status
  WHERE 
  twilio_sent_status = 'failed' 
  AND
  created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  created_at < DATE_TRUNC('week', CURRENT_DATE) 
`

const selectWeeklyTextIns = `
  SELECT COUNT(*) AS count
  FROM public.twilio_messages
  WHERE 
  is_broadcast_reply = false
  AND
  created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  created_at < DATE_TRUNC('week', CURRENT_DATE) 
  AND 
  from_field != '${Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')}'
`

const impactLabelIds = IMPACT_LABEL_IDS.map((id) => `'${id}'`).join(', ')

const selectWeeklyImpactConversations = `
  SELECT l.name as label_name, COUNT(*) as count
  FROM public.conversations_labels cl 
  JOIN public.labels l ON cl.label_id = l.id
  WHERE label_id IN (${impactLabelIds})
  AND
  cl.created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  cl.created_at < DATE_TRUNC('week', CURRENT_DATE) 
  GROUP BY l.name;
`

const selectWeeklyRepliesBrokenByAudienceSegment = `
  SELECT bsms.audience_segment_id, asg.name, COUNT(distinct tm.id) as count
  FROM public.twilio_messages tm 
  LEFT JOIN public.broadcast_sent_message_status bsms 
  ON tm.reply_to_broadcast = bsms.broadcast_id
  LEFT JOIN public.audience_segments asg 
  ON bsms.audience_segment_id = asg.id
  WHERE tm.is_broadcast_reply = true and tm.from_field = bsms.recipient_phone_number
  AND
  tm.created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  tm.created_at < DATE_TRUNC('week', CURRENT_DATE) 
  GROUP BY bsms.audience_segment_id, asg.name
`

const reporterLabelIds = REPORTER_LABEL_IDS.map((id) => `'${id}'`).join(', ')
const selectWeeklyReporterConversation = `
  SELECT l.name as label_name, COUNT(*) as count
  FROM public.conversations_labels cl 
  JOIN public.labels l ON cl.label_id = l.id
  WHERE label_id IN (${reporterLabelIds})
  AND
  cl.created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
  AND 
  cl.created_at < DATE_TRUNC('week', CURRENT_DATE) 
  GROUP BY l.name;
`

const selectWeeklyDataLookUp = `
  SELECT 
      status,
      COUNT(*) AS count
  FROM (
      SELECT 
          rental_status AS status
      FROM 
          lookup_history
      WHERE
      created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
      AND 
      created_at < DATE_TRUNC('week', CURRENT_DATE) 
      UNION ALL
      SELECT 
          tax_status AS status
      FROM 
          lookup_history
      WHERE
      created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'  
      AND 
      created_at < DATE_TRUNC('week', CURRENT_DATE) 
  ) AS combined_statuses
  GROUP BY 
      status
  ORDER BY 
      status;
`

const selectWeeklyTopZipCodeLookup= `
  
`

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
  selectWeeklyBroadcastSent,
  selectWeeklyDataLookUp,
  selectWeeklyFailedMessage,
  selectWeeklyImpactConversations,
  selectWeeklyRepliesBrokenByAudienceSegment,
  selectWeeklyReporterConversation,
  selectWeeklyTextIns,
  selectWeeklyUnsubcribeBroadcastMessageStatus,
  updateTwilioStatusRaw,
}
