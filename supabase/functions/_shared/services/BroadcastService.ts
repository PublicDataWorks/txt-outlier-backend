import { and, eq, inArray, or, sql } from 'drizzle-orm'

import supabase from '../lib/supabase.ts'
import DateUtils from '../misc/DateUtils.ts'
import {
  authors,
  broadcasts,
  BroadcastSegment,
  broadcastsSegments,
  campaigns,
  lookupTemplate,
  messageStatuses,
} from '../drizzle/schema.ts'
import MissiveUtils from '../lib/Missive.ts'
import Twilio from '../lib/Twilio.ts'
import {
  BROADCAST_DOUBLE_FAILURE_QUERY,
  FAILED_DELIVERED_QUERY,
  pgmqDelete,
  pgmqRead,
  pgmqSend,
  queueBroadcastMessages,
} from '../scheduledcron/queries.ts'
import NotFoundError from '../exception/NotFoundError.ts'
import Sentry from '../lib/Sentry.ts'
import { createNextBroadcast, ReconcileOptions } from './BroadcastServiceUtils.ts'
import {
  ARCHIVE_MESSAGE,
  FIRST_MESSAGES_QUEUE,
  MISSIVE_API_RATE_LIMIT,
  SECOND_MESSAGES_QUEUE_NAME,
} from '../constants.ts'
import { cloneBroadcast } from '../misc/utils.ts'
import BadRequestError from '../exception/BadRequestError.ts'

const makeBroadcast = async (): Promise<void> => {
  // @ts-ignore: Property broadcasts exists at runtime
  const broadcast = await supabase.query.broadcasts.findFirst({
    where: eq(broadcasts.editable, true),
    with: {
      broadcastToSegments: {
        with: {
          segment: true,
        },
      },
    },
  })
  if (!broadcast) {
    throw new NotFoundError('Broadcast not found')
  }
  await supabase.transaction(async (tx) => {
    await tx.execute(queueBroadcastMessages(broadcast.id))
    await createNextBroadcast(tx, broadcast)
    await tx.update(broadcasts).set({ editable: false, runAt: new Date() }).where(eq(broadcasts.id, broadcast.id))
  })
}

const sendNow = async (): Promise<void> => {
  // @ts-ignore: Property broadcasts exists at runtime
  const broadcast = await supabase.query.broadcasts.findFirst({
    where: and(eq(broadcasts.editable, true)),
    with: {
      broadcastToSegments: {
        with: {
          segment: true,
        },
      },
    },
  })

  if (!broadcast) {
    throw new Error('Unable to retrieve next broadcast.')
  }
  if (broadcast.runAt) {
    const diffInMinutes = DateUtils.diffInMinutes(broadcast.runAt)
    if (0 <= diffInMinutes && diffInMinutes <= 90) {
      throw new NotFoundError('Unable to send now: the next batch is scheduled to send less than 30 minutes from now')
    }
  }
  await supabase.transaction(async (tx) => {
    await tx.execute(queueBroadcastMessages(broadcast.id))
    const newBroadcastId: { id: number }[] = await tx
      .insert(broadcasts)
      .values(cloneBroadcast(broadcast))
      .returning({ id: broadcasts.id })
    const newBroadcastSegments: BroadcastSegment[] = []
    for (const broadcastSegment of broadcast.broadcastToSegments) {
      newBroadcastSegments.push({
        broadcastId: newBroadcastId[0].id!,
        segmentId: broadcastSegment.segment.id!,
        ratio: broadcastSegment.ratio,
      })
    }
    await tx.update(broadcasts).set({ editable: false, runAt: new Date() }).where(eq(broadcasts.id, broadcast.id))
    await tx.insert(broadcastsSegments).values(newBroadcastSegments)
  })
}

const sendBroadcastMessage = async (isSecond: boolean) => {
  const queueName = isSecond ? SECOND_MESSAGES_QUEUE_NAME : FIRST_MESSAGES_QUEUE
  // We see a lot 429 and 503 errors from Missive API, 180 seconds is a good time to wait
  const results = await supabase.execute(pgmqRead(queueName, 180))
  if (results.length === 0) {
    return
  }

  const messageMetadata = results[0].message
  console.log(`Sending broadcast message. isSecond: ${isSecond}, messageMetadata: ${JSON.stringify(messageMetadata)}`)
  const sharedLabelIds = []
  if (messageMetadata.label_id) {
    sharedLabelIds.push(messageMetadata.label_id)
  }
  const sharedCampaignLabelId = Deno.env.get('SHARED_CAMPAIGN_LABEL_ID')
  if (messageMetadata.campaign_id && sharedCampaignLabelId) {
    sharedLabelIds.push(sharedCampaignLabelId)
  }
  const message = isSecond ? messageMetadata.second_message : messageMetadata.first_message

  const response = await MissiveUtils.sendMessage(
    message,
    messageMetadata.recipient_phone_number,
    isSecond,
    sharedLabelIds,
  )

  if (response.ok) {
    let secondMessageQueueId = undefined
    if (!isSecond && messageMetadata.second_message) {
      const [_, sendResult] = await Promise.all([
        supabase.execute(pgmqDelete(queueName, results[0].msg_id)),
        supabase.execute(pgmqSend(SECOND_MESSAGES_QUEUE_NAME, JSON.stringify(messageMetadata), messageMetadata.delay)),
      ])
      secondMessageQueueId = sendResult[0].send
    } else {
      await supabase.execute(pgmqDelete(queueName, results[0].msg_id))
    }
    const responseBody = await response.json()
    const { id, conversation } = responseBody.drafts
    await supabase
      .insert(messageStatuses)
      .values({
        recipientPhoneNumber: messageMetadata.recipient_phone_number,
        message,
        isSecond,
        broadcastId: messageMetadata?.broadcast_id,
        campaignId: messageMetadata?.campaign_id,
        missiveId: id,
        missiveConversationId: conversation,
        audienceSegmentId: messageMetadata.segment_id,
        secondMessageQueueId: secondMessageQueueId,
      })
  } else {
    const errorMessage = `
        [sendBroadcastMessage] Failed to send broadcast message.
        ${JSON.stringify(await response.json())}
        Message: ${JSON.stringify(results[0])},
        isSecond: ${isSecond},
        broadcast: ${messageMetadata.broadcast_id}
      `
    console.error(errorMessage)
    Sentry.captureException(errorMessage)
    if (results[0].read_ct > 2 && response?.status !== 429) {
      // TODO: Insert somewhere to handle failed deliveries
      await supabase.execute(pgmqDelete(queueName, results[0].msg_id))
      const errorMsg = `Message deleted from ${queueName}. Status code: ${response?.status}. ${
        JSON.stringify(messageMetadata)
      }`
      console.error(errorMsg)
      Sentry.captureException(errorMsg)
    }
  }
}

const reconcileTwilioStatus = async ({ broadcastId, campaignId }: ReconcileOptions) => {
  const id = broadcastId || campaignId
  if (!id) {
    throw new Error('Either broadcastId or campaignId must be provided')
  }
  const sourceTable = broadcastId ? broadcasts : campaigns

  const [record] = await supabase
    .select({
      twilioPaging: sourceTable.twilioPaging,
      recipientCount: broadcastId ? broadcasts.noUsers : campaigns.recipientCount,
      delay: sourceTable.delay,
      runAt: sourceTable.runAt,
    })
    .from(sourceTable)
    .where(eq(sourceTable.id, id))
    .limit(1)

  if (!record?.runAt) {
    throw new BadRequestError('Broadcast has not been scheduled yet')
  }

  let dateSentBefore: Date | undefined = undefined
  if (!record?.twilioPaging) {
    const runAtMs = record.runAt!.getTime()
    // Add recipient count in milliseconds (converting seconds to ms) + 3 hours buffer
    const estimatedCompletionMs = runAtMs + (record.recipientCount! * 2 + 3600 * 3 + record.delay) * 1000
    dateSentBefore = new Date(estimatedCompletionMs)
  }

  const { messages, nextPageUrl } = await Twilio.getMessages(
    record.runAt!,
    record?.twilioPaging || undefined,
    dateSentBefore,
  )
  try {
    for (const msg of messages) {
      const subquery = broadcastId
        ? sql`(SELECT id
             FROM message_statuses
             WHERE broadcast_id = ${id}
             AND recipient_phone_number = ${msg.to}
             AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '30 minutes')
             ORDER BY id DESC LIMIT 1)`
        : sql`(SELECT id
             FROM message_statuses
             WHERE campaign_id = ${id}
             AND recipient_phone_number = ${msg.to}
             AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '30 minutes')
             ORDER BY id DESC LIMIT 1)`

      await supabase
        .update(messageStatuses)
        .set({
          // @ts-ignore - Ignoring type mismatch between MessageStatus and subquery result
          twilioSentStatus: msg.status,
          twilioId: msg.sid,
          // @ts-ignore - Ignoring type mismatch between MessageStatus and subquery result
          twilioSentAt: msg.dateSent,
        })
        .where(eq(messageStatuses.id, subquery))
        .returning({ id: messageStatuses.id })
      console.log(`Updated message status for ${msg.to} with status ${msg.status}, sid: ${msg.sid}.`)
    }
    if (!nextPageUrl) {
      if (broadcastId) {
        await supabase.execute(sql.raw(`SELECT cron.unschedule('reconcile-twilio-status-broadcast-${broadcastId}');`))
        await supabase.execute(sql.raw(`SELECT cron.unschedule('unschedule-broadcast-reconcile-${broadcastId}');`))
      } else {
        await supabase.execute(sql.raw(` SELECT cron.unschedule('reconcile-twilio-status-campaign-${campaignId}');`))
        await supabase.execute(sql.raw(` SELECT cron.unschedule('unschedule-campaign-reconcile-${campaignId}');`))
      }
    } else {
      const pageToken = nextPageUrl ? new URL(nextPageUrl).searchParams.get('PageToken') : null
      await supabase
        .update(sourceTable)
        .set({ twilioPaging: pageToken })
        .where(eq(sourceTable.id, id))
    }
  } catch (error) {
    const errorMessage = `Error in reconcileTwilioStatus: ${error.message}. Stack: ${error.stack}`
    console.error(errorMessage)
    Sentry.captureException(errorMessage)
  }
}

const handleFailedDeliveries = async () => {
  const MAX_RUN_TIME = 50 * 1000
  const startTime = Date.now()

  const failedDelivers = await supabase.execute(sql.raw(FAILED_DELIVERED_QUERY))
  if (!failedDelivers || failedDelivers.length === 0) {
    await supabase.execute(sql.raw(`SELECT cron.unschedule('handle-failed-deliveries-daily');`))
    await supabase.execute(sql.raw(`SELECT cron.unschedule('unschedule-failed-deliveries-handler');`))
    return
  }

  const errorMessage = await supabase
    .select({ content: lookupTemplate.content, name: lookupTemplate.name })
    .from(lookupTemplate)
    .where(
      or(
        eq(lookupTemplate.name, 'missive_broadcast_post_closing_message'),
        eq(lookupTemplate.name, 'missive_broadcast_post_closing_label_id'),
      ),
    )
    .limit(2)

  let postErrorMessages = `❌ This message was undeliverable. The phone number has now been unsubscribed. `
  let closingLabelId: string | undefined = undefined

  for (const message of errorMessage) {
    if (message.name === 'missive_broadcast_post_closing_message') {
      postErrorMessages = message.content || postErrorMessages
    } else if (message.name === 'missive_broadcast_post_closing_label_id') {
      closingLabelId = message.content
    }
  }
  if (!closingLabelId) {
    console.error('Closing label ID not found. Aborting.')
    Sentry.captureException('Closing label ID not found. Aborting.')
    return
  }

  let conversationsToUpdate = []
  let phonesToUpdate = []
  for (const conversation of failedDelivers) {
    const response = await MissiveUtils.createPost(
      conversation.missive_conversation_id,
      postErrorMessages,
      closingLabelId,
    )
    if (response.ok) {
      console.info(`Successfully unsubscribe ${conversation.phone_number}.`)
    } else {
      console.error(
        `[handleFailedDeliveries] Failed to create post. conversationId: ${conversation.missive_conversation_id}, postMessage: ${postErrorMessages}`,
      )
      continue
    }

    conversationsToUpdate.push(conversation.missive_conversation_id)
    phonesToUpdate.push(conversation.phone_number)
    if (conversationsToUpdate.length > 4) {
      await supabase
        .update(messageStatuses)
        .set({ closed: true })
        .where(and(
          inArray(messageStatuses.missiveConversationId, conversationsToUpdate),
        ))
      await supabase.update(authors)
        .set({ exclude: true })
        .where(inArray(authors.phoneNumber, phonesToUpdate))
      conversationsToUpdate = []
      phonesToUpdate = []
    }
    const elapsedTime = Date.now() - startTime
    if (elapsedTime > MAX_RUN_TIME) {
      console.info(`Approaching time limit. Processed ${conversationsToUpdate.length} conversations. Stopping.`)
      break
    }
    await new Promise((resolve) => setTimeout(resolve, MISSIVE_API_RATE_LIMIT))
  }

  if (conversationsToUpdate.length > 0) {
    await supabase
      .update(messageStatuses)
      .set({ closed: true })
      .where(and(
        inArray(messageStatuses.missiveConversationId, conversationsToUpdate),
      ))
    await supabase.update(authors)
      .set({ exclude: true })
      .where(inArray(authors.phoneNumber, phonesToUpdate))
  }
}

const archiveBroadcastDoubleFailures = async () => {
  const MAX_RUN_TIME = 50 * 1000
  const startTime = Date.now()
  const failedDelivers = await supabase.execute(BROADCAST_DOUBLE_FAILURE_QUERY)
  if (!failedDelivers || failedDelivers.length === 0) {
    await supabase.execute(sql.raw(`SELECT cron.unschedule('archive-double-failures-daily');`))
    await supabase.execute(sql.raw(`SELECT cron.unschedule('unschedule-archive-double-failures');`))
    return
  }

  for (const conversation of failedDelivers) {
    const response = await MissiveUtils.createPost(
      conversation.missive_conversation_id,
      ARCHIVE_MESSAGE,
      Deno.env.get('MISSIVE_ARCHIVE_LABEL_ID')!,
    )
    if (response.ok) {
      console.info(
        `Successfully archived conversation for ${conversation.recipient_phone_number} due to double failure.`,
      )
    } else {
      console.error(
        `[archiveBroadcastDoubleFailures] Failed to archive conversation. conversationId: ${conversation.missive_conversation_id}`,
      )
      Sentry.captureException(`Failed to archive conversation: ${conversation.missive_conversation_id}`)
    }
    const elapsedTime = Date.now() - startTime
    if (elapsedTime > MAX_RUN_TIME) {
      console.info(`Approaching time limit. Stopping.`)
      break
    }
    // Respect rate limits for Missive API
    await new Promise((resolve) => setTimeout(resolve, MISSIVE_API_RATE_LIMIT))
  }
}

export default {
  makeBroadcast,
  sendBroadcastMessage,
  sendNow,
  reconcileTwilioStatus,
  handleFailedDeliveries,
  archiveBroadcastDoubleFailures,
} as const
