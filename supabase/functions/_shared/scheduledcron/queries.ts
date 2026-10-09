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
  if (broadcastId) WHERE_CLAUSE = WHERE_CLAUSE.concat(` AND id = $$${broadcastId}$$`)
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

function getPastCampaignsWithStatsQuery(page: number, pageSize: number) {
  return sql`
    WITH past_campaigns AS (
      SELECT
        id,
        title,
        first_message AS "firstMessage",
        second_message AS "secondMessage",
        segments,
        EXTRACT(EPOCH FROM run_at)::INTEGER AS "runAt",
        delay,
        recipient_count AS "recipientCount",
        label_ids AS "labelIds"
      FROM campaigns
      WHERE run_at <= NOW()
      ORDER BY run_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ),
    first_message_counts AS (
      SELECT
        campaign_id,
        COUNT(DISTINCT recipient_phone_number) AS total_first
      FROM message_statuses
      WHERE is_second = FALSE
      AND campaign_id IN (SELECT id FROM past_campaigns)
      GROUP BY campaign_id
    ),
    second_message_counts AS (
      SELECT
        campaign_id,
        COUNT(DISTINCT recipient_phone_number) AS total_second
      FROM message_statuses
      WHERE is_second = TRUE
      AND campaign_id IN (SELECT id FROM past_campaigns)
      GROUP BY campaign_id
    ),
    failed_deliveries AS (
      SELECT
        campaign_id,
        COUNT(DISTINCT (recipient_phone_number, is_second)) AS total_failed
      FROM message_statuses
      WHERE twilio_sent_status IN ('undelivered', 'failed')
      AND campaign_id IN (SELECT id FROM past_campaigns)
      GROUP BY campaign_id
    ),
    unsubscribes AS (
      SELECT
        ms.campaign_id,
        COUNT(DISTINCT ms.recipient_phone_number) AS total_unsub
      FROM unsubscribed_messages um
      JOIN message_statuses ms ON um.reply_to = ms.id
      WHERE ms.campaign_id IN (SELECT id FROM past_campaigns)
      GROUP BY ms.campaign_id
    ),
    replies AS (
      SELECT
        reply_to_campaign AS campaign_id,
        COUNT(DISTINCT from_field) AS total_replies
      FROM twilio_messages
      WHERE reply_to_campaign IS NOT NULL
        AND reply_to_campaign IN (SELECT id FROM past_campaigns)
      GROUP BY reply_to_campaign
    )
    SELECT
      pc.*,
      COALESCE(fmc.total_first, 0) AS "firstMessageCount",
      COALESCE(smc.total_second, 0) AS "secondMessageCount",
      COALESCE(fd.total_failed, 0) AS "failedDeliveries",
      COALESCE(u.total_unsub, 0) AS "unsubscribes",
      COALESCE(r.total_replies, 0) AS "totalReplies"
    FROM past_campaigns pc
    LEFT JOIN first_message_counts fmc ON pc.id = fmc.campaign_id
    LEFT JOIN second_message_counts smc ON pc.id = smc.campaign_id
    LEFT JOIN failed_deliveries fd ON pc.id = fd.campaign_id
    LEFT JOIN unsubscribes u ON pc.id = u.campaign_id
    LEFT JOIN replies r ON pc.id = r.campaign_id
    ORDER BY pc."runAt" DESC
  `
}

// Phones whose last three messages were all undelivered. A phone can only start matching when it gets a new
// message or a status change, so only phones with an undelivered message in the last 30 days are checked.
// Ranking every row in message_statuses instead took 25-60s per call and drove the Disk IO spikes on
// broadcast evenings, when this runs every minute for up to three hours.
const FAILED_DELIVERED_QUERY = `
  WITH candidates AS MATERIALIZED (
    SELECT DISTINCT ms.recipient_phone_number
    FROM message_statuses ms
    WHERE ms.created_at > NOW() - INTERVAL '30 days'
      AND ms.twilio_sent_status IS DISTINCT FROM 'delivered'
  ),
  last_three AS (
    SELECT c.recipient_phone_number, m.id, m.twilio_sent_status, m.missive_conversation_id
    FROM candidates c
    JOIN authors a ON a.phone_number = c.recipient_phone_number
    CROSS JOIN LATERAL (
      SELECT ms.id, ms.twilio_sent_status, ms.missive_conversation_id
      FROM message_statuses ms
      WHERE ms.recipient_phone_number = c.recipient_phone_number
      ORDER BY ms.id DESC
      LIMIT 3
    ) m
    WHERE a.exclude = FALSE
  )
  SELECT
    r.recipient_phone_number as phone_number,
    (array_agg(r.missive_conversation_id ORDER BY r.id DESC))[1] as missive_conversation_id
  FROM last_three r
  WHERE NOT EXISTS (
    SELECT 1 FROM conversations_labels cl
    WHERE
      cl.conversation_id = r.missive_conversation_id
      AND cl.label_id = '${Deno.env.get('MISSIVE_REPLY_LABEL_ID')!}'
      AND cl.is_archived = FALSE
  )
  GROUP BY r.recipient_phone_number
  HAVING COUNT(*) = 3
    AND SUM(CASE WHEN r.twilio_sent_status = 'delivered' THEN 1 ELSE 0 END) = 0
  LIMIT 40;
`

const BROADCAST_DOUBLE_FAILURE_QUERY = sql.raw(`
  WITH LatestBroadcast AS (
    SELECT id
    FROM broadcasts
    WHERE editable = false AND run_at > NOW() - INTERVAL '7 days'
  ),
  QualifiedPhoneNumbers AS (
      SELECT
          bsms.recipient_phone_number
      FROM message_statuses bsms
      JOIN LatestBroadcast lb ON bsms.broadcast_id = lb.id
      LEFT JOIN conversations c ON bsms.missive_conversation_id = c.id
      WHERE
          c.shared_label_names IS NULL OR
          c.shared_label_names = '' OR
          (c.shared_label_names NOT ILIKE '%archive%' AND c.shared_label_names NOT ILIKE '%undeliverable%')
      GROUP BY bsms.recipient_phone_number
      HAVING
          COUNT(*) = 2
          AND SUM(CASE WHEN bsms.twilio_sent_status IN ('undelivered', 'failed') THEN 1 ELSE 0 END) = 2
  )
  SELECT DISTINCT ON (ms.recipient_phone_number)
      ms.recipient_phone_number,
      ms.missive_conversation_id
  FROM message_statuses ms
  JOIN QualifiedPhoneNumbers qpn ON ms.recipient_phone_number = qpn.recipient_phone_number
  LIMIT 40;
`)

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
  getPastCampaignsWithStatsQuery,
  pgmqDelete,
  pgmqRead,
  pgmqSend,
  queueBroadcastMessages,
  selectBroadcastDashboard,
}
