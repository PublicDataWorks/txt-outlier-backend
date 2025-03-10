import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import supabase from '../lib/supabase.ts'
import DateUtils from '../misc/DateUtils.ts'
import {
  authors,
  broadcasts,
  BroadcastSegment,
  broadcastsSegments,
  campaigns,
  conversationsAuthors,
  conversationsLabels,
  lookupTemplate,
  messageStatuses,
  twilioMessages,
} from '../drizzle/schema.ts'
import {
  ARCHIVE_BROADCAST_DOUBLE_FAILURES_CRON,
  HANDLE_FAILED_DELIVERIES_CRON,
  reconcileTwilioStatusCron,
} from '../scheduledcron/cron.ts'
import MissiveUtils from '../lib/Missive.ts'
import Twilio from '../lib/Twilio.ts'
import {
  BROADCAST_DOUBLE_FAILURE_QUERY,
  FAILED_DELIVERED_QUERY,
  pgmqDelete,
  pgmqRead,
  pgmqSend,
  queueBroadcastMessages,
  UNSCHEDULE_COMMANDS,
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
    await tx.execute(reconcileTwilioStatusCron(broadcast.id, broadcast.noUsers + broadcast.delay + 1800))
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
  const diffInMinutes = DateUtils.diffInMinutes(broadcast.runAt)
  if (0 <= diffInMinutes && diffInMinutes <= 90) {
    throw new NotFoundError('Unable to send now: the next batch is scheduled to send less than 30 minutes from now')
  }
  await supabase.transaction(async (tx) => {
    await tx.execute(queueBroadcastMessages(broadcast.id))
    await tx.execute(reconcileTwilioStatusCron(broadcast.id, broadcast.noUsers * 2 + broadcast.delay + 300))
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
  const results = await supabase.execute(pgmqRead(queueName, 60))
  if (results.length === 0) {
    return
  }
  const messageMetadata = results[0].message
  console.log(`Sending broadcast message. isSecond: ${isSecond}, messageMetadata: ${JSON.stringify(messageMetadata)}`)
  const message = isSecond ? messageMetadata.second_message : messageMetadata.first_message
  const response = await MissiveUtils.sendMessage(message, messageMetadata.recipient_phone_number, isSecond)
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
        message: message,
        isSecond: isSecond,
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
        Message: ${JSON.stringify(results[0])},
        isSecond: ${isSecond},
        broadcast: ${messageMetadata.broadcast_id}
        Missive's response = ${JSON.stringify(await response.json())}
      `
    console.error(errorMessage)
    Sentry.captureException(errorMessage)
    if (results[0].read_ct > 2 && response?.status !== 429) {
      // TODO: Insert somewhere to handle failed deliveries
      await supabase.execute(pgmqDelete(queueName, results[0].msg_id))
      Sentry.captureException(
        `Message deleted from ${queueName}. Status code: ${response?.status}. ${JSON.stringify(messageMetadata)}`,
      )
    }
  }
}

const reconcileTwilioStatus = async ({ broadcastId, campaignId, runAt }: ReconcileOptions) => {
  const id = broadcastId || campaignId

  if (!id) {
    throw new Error('Either broadcastId or campaignId must be provided')
  }
  const sourceTable = broadcastId ? broadcasts : campaigns

  const [record] = await supabase
    .select({ twilioPaging: sourceTable.twilioPaging })
    .from(sourceTable)
    .where(eq(sourceTable.id, id))
    .limit(1)

  const { messages, nextPageUrl } = await Twilio.getMessages(
    new Date(runAt),
    record?.twilioPaging || undefined,
  )
  try {
    for (const msg of messages) {
      const subquery = broadcastId
        ? sql`(SELECT id
             FROM message_statuses
             WHERE broadcast_id = ${id}
             AND recipient_phone_number = ${msg.to}
             AND (twilio_sent_status IS NULL OR twilio_id IS NULL)
             ORDER BY id DESC LIMIT 1)`
        : sql`(SELECT id
             FROM message_statuses
             WHERE campaign_id = ${id}
             AND recipient_phone_number = ${msg.to}
             AND (twilio_sent_status IS NULL OR twilio_id IS NULL)
             ORDER BY id DESC LIMIT 1)`

      await supabase
        .update(messageStatuses)
        .set({
          twilioSentStatus: msg.status,
          twilioId: msg.sid,
          twilioSentAt: msg.dateSent,
        })
        .where(eq(messageStatuses.id, subquery))
    }
    if (!nextPageUrl) {
      await Promise.all([
        await supabase.execute(UNSCHEDULE_COMMANDS.DELAY_RECONCILE_TWILIO),
        await supabase.execute(UNSCHEDULE_COMMANDS.RECONCILE_TWILIO),
        await supabase.execute(HANDLE_FAILED_DELIVERIES_CRON),
      ])
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
  const MAX_RUN_TIME = 6 * 60 * 1000
  const startTime = Date.now()

  const failedDelivers = await supabase.execute(sql.raw(FAILED_DELIVERED_QUERY))
  if (!failedDelivers || failedDelivers.length === 0) {
    try {
      await supabase.execute(ARCHIVE_BROADCAST_DOUBLE_FAILURES_CRON)
      await supabase.execute(UNSCHEDULE_COMMANDS.HANDLE_FAILED_DELIVERIES)
    } catch (e) {
      console.error(`Failed to unschedule handleFailedDeliveries: ${e}`)
    }
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
  const MAX_RUN_TIME = 60 * 1000
  const startTime = Date.now()
  const failedDelivers = await supabase.execute(BROADCAST_DOUBLE_FAILURE_QUERY)
  if (!failedDelivers || failedDelivers.length === 0) {
    await supabase.execute(UNSCHEDULE_COMMANDS.ARCHIVE_BROADCAST_DOUBLE_FAILURES)
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

// One-time function to label existing conversations with replies.
// TODO: Remove this function after execution.
const labelConversationsWithReplies = async () => {
  const MAX_RUN_TIME = 60 * 1000
  const startTime = Date.now()
  const BROADCAST_PHONE_NUMBER = Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')!
  const REPLY_LABEL_ID = Deno.env.get('MISSIVE_REPLY_LABEL_ID')!

  if (!REPLY_LABEL_ID) {
    console.error('Reply label ID not found. Aborting.')
    Sentry.captureException('Reply label ID not found. Aborting.')
    return
  }

  const repliesResult = await supabase
    .select({
      conversationId: conversationsAuthors.conversationId,
    })
    .from(twilioMessages)
    .innerJoin(
      conversationsAuthors,
      eq(twilioMessages.fromField, conversationsAuthors.authorPhoneNumber),
    )
    .leftJoin(
      conversationsLabels,
      and(
        eq(conversationsAuthors.conversationId, conversationsLabels.conversationId),
        eq(conversationsLabels.labelId, REPLY_LABEL_ID),
      ),
    )
    .where(
      and(
        ne(twilioMessages.fromField, BROADCAST_PHONE_NUMBER),
        isNull(conversationsLabels.id),
      ),
    )
    .groupBy(conversationsAuthors.conversationId)
    .limit(2)

  if (!repliesResult || repliesResult.length === 0) {
    console.info('No conversations with replies found to label.')
    return
  }

  for (const conversation of repliesResult) {
    console.log(`Labeling conversation ${conversation.conversationId} with reply label.`)
    const response = await MissiveUtils.createPost(
      conversation.conversationId,
      '',
      REPLY_LABEL_ID,
    )

    if (response.ok) {
      console.info(
        `Successfully labeled conversation ${conversation.conversationId} with reply label.`,
      )

      await supabase
        .insert(conversationsLabels)
        .values({
          conversationId: conversation.conversationId,
          labelId: REPLY_LABEL_ID,
        })
    } else {
      console.error(
        `[labelConversationsWithReplies] Failed to label conversation. conversationId: ${conversation.conversationId}`,
      )
      Sentry.captureException(`Failed to label conversation: ${conversation.conversationId}`)
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
  labelConversationsWithReplies,
} as const
