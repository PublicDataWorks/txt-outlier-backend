import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

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
import {
  handleFailedDeliveriesCron,
  reconcileTwilioStatusCron,
  sendFirstMessagesCron, sendSecondMessagesCron,
} from '../scheduledcron/cron.ts'
import { cloneBroadcast } from '../dto/BroadcastRequestResponse.ts'
import MissiveUtils from '../lib/Missive.ts'
import { sleep } from '../misc/utils.ts'
import {
  FAILED_DELIVERED_QUERY,
  insertOutgoingMessagesFallbackQuery, pgmq_delete, pgmq_read,
  queueBroadcastMessages,
  UNSCHEDULE_COMMANDS,
} from '../scheduledcron/queries.ts'
import NotFoundError from '../exception/NotFoundError.ts'
import BadRequestError from '../exception/BadRequestError.ts'
import Sentry from '../lib/Sentry.ts'
import {
  insertBroadcastSegmentRecipients,
  isBroadcastRunning,
  makeNextBroadcastSchedule,
} from './BroadcastServiceUtils.ts'
import { FIRST_MESSAGES_QUEUE, MISSIVE_API_RATE_LIMIT, SECOND_MESSAGES_QUEUE_NAME } from '../constants.ts'

const makeBroadcast = async (): Promise<void> => {
  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    throw new BadRequestError('Unable to make broadcast: another broadcast is running')
  }
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
    await tx.execute(sql.raw(queueBroadcastMessages(broadcast.id)))
    await makeNextBroadcastSchedule(tx, broadcast)
    await tx.execute(sendFirstMessagesCron(broadcast.id))
    await tx.update(broadcasts).set({ editable: false }).where(eq(broadcasts.id, broadcast.id))
  })
  await supabase.execute(UNSCHEDULE_COMMANDS.INVOKE_BROADCAST)
}

const sendNow = async (): Promise<void> => {
  const nextBroadcast = await supabase.query.broadcasts.findFirst({
    where: and(eq(broadcasts.editable, true)),
    with: {
      broadcastToSegments: {
        with: {
          segment: true,
        },
      },
    },
  })

  if (!nextBroadcast) {
    throw new Error('Unable to retrieve next broadcast.')
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    console.error(`SendNow: Broadcast has no associated segment. Data: ${JSON.stringify(nextBroadcast)}`)
    throw new Error('Broadcast has no associated segment.')
  }
  const diffInMinutes = DateUtils.diffInMinutes(nextBroadcast.runAt)
  if (0 <= diffInMinutes && diffInMinutes <= 30) {
    throw new NotFoundError('Unable to send now: the next batch is scheduled to send less than 30 minutes from now')
  }

  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    throw new BadRequestError('Unable to send now: another broadcast is running')
  }

  await supabase.transaction(async (tx) => {
    const newId: { id: number }[] = await tx.insert(broadcasts).values(cloneBroadcast(nextBroadcast))
      .returning({ id: broadcasts.id })
    const newBroadcastSegments: BroadcastSegment[] = []
    for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
      await insertBroadcastSegmentRecipients(tx, broadcastSegment, nextBroadcast)
      newBroadcastSegments.push({
        broadcastId: newId[0].id!,
        segmentId: broadcastSegment.segment.id!,
        ratio: broadcastSegment.ratio,
      })
    }
    const fallbackStatement = await insertOutgoingMessagesFallbackQuery(tx, nextBroadcast)
    if (fallbackStatement) {
      await tx.execute(sql.raw(fallbackStatement))
    }
    await tx.update(broadcasts).set({ editable: false, runAt: new Date() }).where(eq(broadcasts.id, nextBroadcast.id))
    await tx.insert(broadcastsSegments).values(newBroadcastSegments)
    await tx.execute(sendFirstMessagesCron(nextBroadcast.id))
  })
}

const sendBroadcastMessage = async (broadcastId: number, isSecond: boolean) => {
  const queueName = isSecond ? SECOND_MESSAGES_QUEUE_NAME : FIRST_MESSAGES_QUEUE
  const results = await supabase.execute(pgmq_read(queueName, 1))
  if (results.length === 0) {
    if (isSecond) {
      await supabase.execute(sql.raw(UNSCHEDULE_COMMANDS.SEND_SECOND_MESSAGES))
      await supabase.execute(sql.raw(UNSCHEDULE_COMMANDS.DELAY_SEND_SECOND_MESSAGES))
      await supabase.execute(sql.raw(reconcileTwilioStatusCron(broadcastId)))
    } else {
      await supabase.execute(UNSCHEDULE_COMMANDS.SEND_FIRST_MESSAGES)
      await supabase.execute(sendSecondMessagesCron(broadcastId))
    }
    return
  }
  const message = results[0].message
  const response = await MissiveUtils.sendMessage(message.message, message.recipient_phone_number)
  if (response.ok) {
    await supabase.execute(pgmq_delete(queueName, results[0].msg_id))
    const responseBody = await response.json()
    const { id, conversation } = responseBody.drafts
    await supabase
      .insert(broadcastSentMessageStatus)
      .values({
        recipientPhoneNumber: message.recipient_phone_number,
        message: message.message,
        isSecond: true,
        broadcastId: message.broadcast_id,
        missiveId: id,
        missiveConversationId: conversation,
        audienceSegmentId: message.segment_id,
      })
  } else {
    let errorMessage = `
        Failed to send broadcast message.
        Message: ${JSON.stringify(results[0])},
        isSecond: ${isSecond},
        broadcast: ${broadcastId}
        Missive's response = ${JSON.stringify(await response.json())}
      `;
    if (results[0].read_ct > 2) {
      await supabase.execute(pgmq_delete(queueName, results[0].msg_id));
      errorMessage += ` Message deleted from queue after ${results[0].read_ct} retries.`;
    }
    Sentry.captureException(errorMessage);
    console.error(errorMessage);
  }
}

const reconcileTwilioStatus = async (broadcastId: number) => {
  const CHUNK_SIZE = 200
  const MAX_RETRIES = 3

  try {
    const failedStatusConversations = await supabase
      .selectDistinct({
        missive_conversation_id: broadcastSentMessageStatus.missiveConversationId,
        phones: broadcastSentMessageStatus.recipientPhoneNumber,
        missive_id: broadcastSentMessageStatus.missiveId,
      })
      .from(broadcastSentMessageStatus)
      .where(and(
        eq(broadcastSentMessageStatus.broadcastId, broadcastId),
        eq(broadcastSentMessageStatus.closed, false),
        isNull(broadcastSentMessageStatus.twilioId),
        eq(broadcastSentMessageStatus.twilioSentStatus, 'delivered'),
      ))
      .limit(CHUNK_SIZE)
      .execute()
    if (failedStatusConversations.length === 0) {
      await supabase.execute(UNSCHEDULE_COMMANDS.RECONCILE_TWILIO)
      await supabase.execute(UNSCHEDULE_COMMANDS.DELAY_RECONCILE_TWILIO)
      await supabase.execute(sql.raw(handleFailedDeliveriesCron()))
      return
    }
    for (const conversation of failedStatusConversations) {
      let retries = 0
      let response
      while (retries < MAX_RETRIES) {
        try {
          response = await MissiveUtils.getMissiveMessage(conversation.missive_id)
          break
        } catch (_) {
          retries++
          if (retries === MAX_RETRIES) {
            console.error(`Failed to get message ${conversation.missive_id} after ${MAX_RETRIES} attempts.`)
            break
          }
          await sleep(MISSIVE_API_RATE_LIMIT)
        }
      }
      if (response) {
        let updateData = {}
        const missiveMessage = response.messages
        if (missiveMessage.external_id) {
          updateData = {
            twilioSentAt: missiveMessage.delivered_at
              ? new Date(missiveMessage.delivered_at * 1000).toISOString()
              : null,
            twilioId: missiveMessage.external_id,
            twilioSentStatus: missiveMessage.delivered_at ? 'delivered' : 'sent',
          }
        } else {
          updateData = {
            twilioSentAt: null,
            twilioId: null,
            twilioSentStatus: 'undelivered',
          }
        }
        await supabase
          .update(broadcastSentMessageStatus)
          .set(updateData)
          .where(eq(broadcastSentMessageStatus.missiveId, conversation.missive_id))
        console.info(
          `Successfully updated broadcastSentMessageStatus for ${conversation.missive_id}. Data: ${
            JSON.stringify(updateData)
          }`,
        )
        await sleep(MISSIVE_API_RATE_LIMIT)
      }
    }
  } catch (error) {
    console.error(`Error fetching failed conversations for broadcast ID ${broadcastId}: ${error.toString()}`)
    Sentry.captureException(error)
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
    try {
      await MissiveUtils.createPost(conversation.missive_conversation_id, postErrorMessages, closingLabelId)
      console.info(`Successfully unsubscribe ${conversation.phone_number}.`)
    } catch (error) {
      console.error(`Failed to create post when handleFailedDeliveries: ${error}`)
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
