import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'

import supabase from '../lib/supabase.ts'
import DateUtils from '../misc/DateUtils.ts'
import {
  authors,
  broadcasts,
  BroadcastSegment,
  broadcastSentMessageStatus,
  broadcastsSegments,
  lookupTemplate,
} from '../drizzle/schema.ts'
import { handleFailedDeliveriesCron, reconcileTwilioStatusCron } from '../scheduledcron/cron.ts'
import MissiveUtils from '../lib/Missive.ts'
import Twilio from '../lib/Twilio.ts'
import {
  FAILED_DELIVERED_QUERY,
  pgmq_delete,
  pgmq_read,
  pgmq_send,
  queueBroadcastMessages,
  UNSCHEDULE_COMMANDS,
} from '../scheduledcron/queries.ts'
import NotFoundError from '../exception/NotFoundError.ts'
import BadRequestError from '../exception/BadRequestError.ts'
import Sentry from '../lib/Sentry.ts'
import { isBroadcastRunning, makeNextBroadcastSchedule } from './BroadcastServiceUtils.ts'
import { FIRST_MESSAGES_QUEUE, MISSIVE_API_RATE_LIMIT, SECOND_MESSAGES_QUEUE_NAME } from '../constants.ts'
import { cloneBroadcast } from '../misc/utils.ts'

const makeBroadcast = async (): Promise<void> => {
  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    throw new BadRequestError('Unable to make broadcast: another broadcast is running')
  }
  // @ts-ignore: Property broadcasts exists at runtime
  const broadcast = await supabase.query.broadcasts.findFirst({
    where: and(
      eq(broadcasts.editable, true),
      lt(broadcasts.runAt, DateUtils.advance(24 * 60 * 60 * 1000)), // TODO: Prevent making 2 broadcast in a day
    ),
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
    await tx.execute(reconcileTwilioStatusCron(broadcast.id, broadcast.noUsers * 2 + broadcast.delay + 300))
    await makeNextBroadcastSchedule(tx, broadcast)
    await tx.update(broadcasts).set({ editable: false }).where(eq(broadcasts.id, broadcast.id))
  })
  await supabase.execute(UNSCHEDULE_COMMANDS.INVOKE_BROADCAST)
}

const sendNow = async (): Promise<void> => {
  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    throw new BadRequestError('Unable to send now: another broadcast is running')
  }
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
  const results = await supabase.execute(pgmq_read(queueName, 10))
  if (results.length === 0) {
    return
  }
  const messageMetadata = results[0].message
  const message = isSecond ? messageMetadata.second_message : messageMetadata.first_message
  const response = await MissiveUtils.sendMessage(message, messageMetadata.recipient_phone_number, isSecond)
  if (response.ok) {
    if (!isSecond) {
      await Promise.all([
        supabase.execute(pgmq_delete(queueName, results[0].msg_id)),
        supabase.execute(pgmq_send(SECOND_MESSAGES_QUEUE_NAME, JSON.stringify(messageMetadata), messageMetadata.delay)),
      ])
    } else {
      await supabase.execute(pgmq_delete(queueName, results[0].msg_id))
    }
    const responseBody = await response.json()
    const { id, conversation } = responseBody.drafts
    await supabase
      .insert(broadcastSentMessageStatus)
      .values({
        recipientPhoneNumber: messageMetadata.recipient_phone_number,
        message: message,
        isSecond: isSecond,
        broadcastId: messageMetadata.broadcast_id,
        missiveId: id,
        missiveConversationId: conversation,
        audienceSegmentId: messageMetadata.segment_id,
      })
  } else {
    let errorMessage = `
        [sendBroadcastMessage] Failed to send broadcast message.
        Message: ${JSON.stringify(results[0])},
        isSecond: ${isSecond},
        broadcast: ${messageMetadata.broadcast_id}
        Missive's response = ${JSON.stringify(await response.json())}
      `
    if (results[0].read_ct > 2) {
      await supabase.execute(pgmq_delete(queueName, results[0].msg_id))
      errorMessage += ` Message deleted from queue after ${results[0].read_ct} retries.`
    }
    console.error(errorMessage)
    Sentry.captureException(errorMessage)
  }
}

const reconcileTwilioStatus = async (broadcastId: number, broadcastRunAt: number) => {
  const [broadcast] = await supabase
    .select({ twilioPaging: broadcasts.twilioPaging })
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1)
  const { messages, nextPageUrl } = await Twilio.getMessages(
    new Date(broadcastRunAt),
    broadcast?.twilioPaging || undefined,
  )
  try {
    for (const msg of messages) {
      await supabase
        .update(broadcastSentMessageStatus)
        .set({
          twilioSentStatus: msg.status,
          twilioId: msg.sid,
          twilioSentAt: msg.dateSent,
        })
        .where(
          and(
            eq(
              broadcastSentMessageStatus.id,
              sql`(SELECT id
               FROM broadcast_sent_message_status
               WHERE broadcast_id = ${broadcastId}
               AND recipient_phone_number = ${msg.to}
               AND (twilio_sent_status IS NULL OR twilio_id IS NULL)
               ORDER BY id DESC LIMIT 1)`,
            ),
          ),
        )
    }
    if (!nextPageUrl) {
      await Promise.all([
        await supabase.execute(UNSCHEDULE_COMMANDS.DELAY_RECONCILE_TWILIO),
        await supabase.execute(UNSCHEDULE_COMMANDS.RECONCILE_TWILIO),
        await supabase.execute(handleFailedDeliveriesCron()),
      ])
    } else {
      await supabase
        .update(broadcasts)
        .set({
          twilioPaging: nextPageUrl ? new URL(nextPageUrl).searchParams.get('PageToken') : null,
        })
        .where(eq(broadcasts.id, broadcastId))
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
    const response = await MissiveUtils.createPost(conversation.missive_conversation_id, postErrorMessages, closingLabelId)
    if (response.ok) {
      console.info(`Successfully unsubscribe ${conversation.phone_number}.`)
    } else {
      console.error(`[handleFailedDeliveries] Failed to create post. conversationId: ${conversation.missive_conversation_id}, postMessage: ${postErrorMessages}`)
      continue
    }

    conversationsToUpdate.push(conversation.missive_conversation_id)
    phonesToUpdate.push(conversation.phone_number)
    if (conversationsToUpdate.length > 4) {
      await supabase
        .update(broadcastSentMessageStatus)
        .set({ closed: true })
        .where(and(
          inArray(broadcastSentMessageStatus.missiveConversationId, conversationsToUpdate),
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
      .update(broadcastSentMessageStatus)
      .set({ closed: true })
      .where(and(
        inArray(broadcastSentMessageStatus.missiveConversationId, conversationsToUpdate),
      ))
    await supabase.update(authors)
      .set({ exclude: true })
      .where(inArray(authors.phoneNumber, phonesToUpdate))
  }
}

export default {
  makeBroadcast,
  sendBroadcastMessage,
  sendNow,
  reconcileTwilioStatus,
  handleFailedDeliveries,
} as const
