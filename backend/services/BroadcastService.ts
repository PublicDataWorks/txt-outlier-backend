import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import * as log from 'log'
import * as DenoSentry from 'sentry/deno'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import supabase from '../lib/supabase.ts'
import DateUtils from '../misc/DateUtils.ts'
import {
  AudienceSegment,
  authors,
  Broadcast,
  broadcasts,
  BroadcastSegment,
  broadcastSentMessageStatus,
  broadcastsSegments,
  lookupTemplate,
  OutgoingMessage,
  outgoingMessages,
} from '../drizzle/schema.ts'
import SystemError from '../exception/SystemError.ts'
import {
  handleFailedDeliveriesCron,
  invokeBroadcastCron,
  JOB_NAMES,
  SELECT_JOB_NAMES,
  sendFirstMessagesCron,
  sendPostCron,
  sendSecondMessagesCron,
  UNSCHEDULE_DELAY_SEND_POST,
  UNSCHEDULE_HANDLE_FAILED_DELIVERIES,
  UNSCHEDULE_INVOKE,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_SEND_POST_INVOKE,
  UNSCHEDULE_SEND_SECOND_INVOKE,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
} from '../scheduledcron/cron.ts'
import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToBroadcastMessagesStatus,
  convertToFutureBroadcast,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import MissiveUtils from '../lib/Missive.ts'
import { sleep } from '../misc/utils.ts'
import {
  BroadcastDashBoardQueryReturn,
  FAILED_DELIVERED_QUERY,
  insertOutgoingMessagesFallbackQuery,
  insertOutgoingMessagesQuery,
  selectBroadcastDashboard,
} from '../scheduledcron/queries.ts'
import RouteError from '../exception/RouteError.ts'
import { SEND_NOW_STATUS } from '../misc/AppResponse.ts'
import { MISSIVE_API_RATE_LIMIT } from '../constants/constants.ts'

// Called by Postgres Trigger
const makeBroadcast = async (): Promise<void> => {
  // TODO: A broadcast may be running now
  const nextBroadcast = await supabase.query.broadcasts.findFirst({
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

  if (!nextBroadcast) {
    throw new RouteError(400, 'Unable to retrieve the next broadcast')
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    throw new SystemError(`Broadcast has no associated segment. Data: ${JSON.stringify(nextBroadcast)}`)
  }
  try {
    await supabase.transaction(async (tx) => {
      for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
        await insertBroadcastSegmentRecipients(tx, broadcastSegment, nextBroadcast)
      }
      const fallbackStatement = await insertOutgoingMessagesFallbackQuery(tx, nextBroadcast)
      if (fallbackStatement) {
        await tx.execute(sql.raw(fallbackStatement))
      }
      await makeNextBroadcastSchedule(tx, nextBroadcast)
      await tx.execute(sql.raw(sendFirstMessagesCron(nextBroadcast.id)))
      await tx.update(broadcasts).set({ editable: false }).where(eq(broadcasts.id, nextBroadcast.id))
    })
  } catch (error) {
    log.error(`Error make broadcast. ${error}`)
    DenoSentry.captureException(`Error make broadcast. ${error}`)
    return
  }
  // TODO: If this fails, recreate Postgres trigger
}

// Called by Missive sidebar
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
    log.error('SendNow: Unable to retrieve next broadcast')
    throw new SystemError(SEND_NOW_STATUS.Error.toString()) //
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    log.error(`SendNow: Broadcast has no associated segment. Data: ${JSON.stringify(nextBroadcast)}`)
    throw new SystemError(SEND_NOW_STATUS.Error.toString())
  }
  const diffInMinutes = DateUtils.diffInMinutes(nextBroadcast.runAt)
  if (0 <= diffInMinutes && diffInMinutes <= 30) {
    log.error('Unable to send now: the next batch is scheduled to send less than 30 minutes from now')
    throw new RouteError(400, SEND_NOW_STATUS.AboutToRun.toString())
  }

  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    log.error(`Unable to send now: another broadcast is running`)
    throw new RouteError(400, SEND_NOW_STATUS.Running.toString())
  }
  try {
    await supabase.transaction(async (tx) => {
      const newId: { id: number }[] = await tx.insert(broadcasts).values(convertToFutureBroadcast(nextBroadcast))
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
      await tx.execute(sql.raw(sendFirstMessagesCron(nextBroadcast.id)))
    })
  } catch (error) {
    log.error(`Error send-now. ${error}`)
    DenoSentry.captureException(`Error send-now. ${error}`)
    return
  }
}

const sendBroadcastSecondMessage = async (broadcastID: number) => {
  // This function is called by a CRON job every minute
  const startTime = Date.now()
  const results = await supabase
    .select()
    .from(outgoingMessages)
    .where(
      and(
        eq(outgoingMessages.broadcastId, broadcastID),
        eq(outgoingMessages.isSecond, true),
        eq(outgoingMessages.processed, false),
      ),
    )
    .orderBy(outgoingMessages.id)
    .limit(40)

  if (results.length === 0) {
    // No messages found, unschedule CRON jobs
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_INVOKE))
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_MESSAGES))
    await supabase.execute(sql.raw(sendPostCron(broadcastID)))
    return
  }
  const idsToMarkAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id!)
  // Temporarily mark these messages as processed, so later requests don't pick them up
  await supabase
    .update(outgoingMessages)
    .set({ processed: true })
    .where(inArray(outgoingMessages.id, idsToMarkAsProcessed))

  const processedIds = []
  for (const outgoing of results) {
    const loopStartTime = Date.now()
    const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
    if (response.ok) {
      const responseBody = await response.json()
      const { id, conversation } = responseBody.drafts
      // Can not bulk insert because the webhook service run in parallel to update the status
      await supabase
        .insert(broadcastSentMessageStatus)
        .values(convertToBroadcastMessagesStatus(outgoing, id, conversation))
    } else {
      const errorMessage = `Failed to send broadcast second messages.
              Broadcast id: ${broadcastID}, outgoing: ${JSON.stringify(outgoing)},
              Missive's respond = ${JSON.stringify(await response.json())}`
      log.error(errorMessage)
      DenoSentry.captureException(errorMessage)
    }
    processedIds.push(outgoing.id)
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached in sendBroadcastSecondMessage. Exiting loop.')
      break
    }
    // Wait for 1s, considering the time spent in API call and other operations
    const remainingTime = MISSIVE_API_RATE_LIMIT - (Date.now() - loopStartTime)
    if (remainingTime > 0) {
      await sleep(remainingTime)
    }
  }
  if (processedIds.length > 0) {
    await supabase
      .delete(outgoingMessages)
      .where(inArray(outgoingMessages.id, processedIds))
    await supabase
      .update(outgoingMessages)
      .set({ processed: false })
      .where(inArray(outgoingMessages.id, idsToMarkAsProcessed))
  }
}

const sendBroadcastFirstMessage = async (broadcastID: number) => {
  // This function is called by a CRON job every minute
  const startTime = Date.now()
  const results = await supabase
    .select()
    .from(outgoingMessages)
    .where(
      and(
        eq(outgoingMessages.broadcastId, broadcastID),
        eq(outgoingMessages.isSecond, false),
        eq(outgoingMessages.processed, false),
      ),
    )
    .orderBy(outgoingMessages.id)
    .limit(40) // API limit of 1 request per second

  if (results.length === 0) {
    // No messages found, finished sending first messages
    await supabase.execute(sql.raw(sendSecondMessagesCron(startTime, broadcastID, 1)))
    // TODO: There may be some messages that were not processed in the last batch
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_FIRST_MESSAGES))
    return
  }
  const idsToMarkAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id!)
  // Temporarily mark these messages as processed, so later requests don't pick them up
  await supabase.update(outgoingMessages).set({ processed: true }).where(
    inArray(outgoingMessages.id, idsToMarkAsProcessed),
  )
  const processedIds = []
  for (const outgoing of results) {
    const loopStartTime = Date.now()
    const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
    if (response.ok) {
      const responseBody = await response.json()
      const { id, conversation } = responseBody.drafts
      // Can not bulk insert because the webhook service run in parallel to update the status
      // Need await to ensure 1 request per second
      await supabase
        .insert(broadcastSentMessageStatus)
        .values(convertToBroadcastMessagesStatus(outgoing, id, conversation))
    } else {
      const errorMessage =
        `Failed to send broadcast first message. Broadcast id: ${broadcastID}}, Missive's respond = ${
          JSON.stringify(await response.json())
        }`
      log.error(errorMessage)
      DenoSentry.captureException(errorMessage)
    }
    processedIds.push(outgoing.id)
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached in sendBroadcastFirstMessage. Exiting loop.')
      break
    }
    // Wait for 1s, considering the time spent in API call and other operations
    const remainingTime = 1000 - (Date.now() - loopStartTime)
    if (remainingTime > 0) {
      await sleep(remainingTime)
    }
  }

  if (processedIds.length > 0) {
    await supabase
      .delete(outgoingMessages)
      .where(inArray(outgoingMessages.id, processedIds))
    await supabase
      .update(outgoingMessages)
      .set({ processed: false })
      .where(inArray(outgoingMessages.id, idsToMarkAsProcessed))
  }
}

const getAll = async (
  limit = 5, // Limit past batches
  cursor?: number,
): Promise<BroadcastResponse> => {
  const selectQuery = selectBroadcastDashboard(cursor ? limit : limit + 1, cursor)
  const results: BroadcastDashBoardQueryReturn[] = await supabase.execute(sql.raw(selectQuery))
  // "runAt" value should be a date, but it appears as a string when used in Supabase.
  results.forEach((broadcast) => broadcast.runAt = new Date(broadcast.runAt))
  const response = new BroadcastResponse()
  if (results.length === 0) {
    return response
  }
  if (cursor && results[0].runAt < new Date()) {
    response.past = results.map((broadcast) => convertToPastBroadcast(broadcast))
  } else {
    response.upcoming = convertToUpcomingBroadcast(results[0])
    response.past = results.slice(1).map((broadcast) => convertToPastBroadcast(broadcast))
  }

  const lastRunAtTimestamp = results[results.length - 1].runAt.getTime() / 1000
  response.currentCursor = Math.max(Math.floor(lastRunAtTimestamp) - 1, 0)
  return response
}

const patch = async (
  id: number,
  broadcast: BroadcastUpdate,
): Promise<UpcomingBroadcastResponse | undefined> => {
  return await supabase.transaction(async (tx) => {
    const result: Broadcast[] = await tx.update(broadcasts)
      .set({
        firstMessage: broadcast.firstMessage,
        secondMessage: broadcast.secondMessage,
        runAt: broadcast.runAt ? new Date(broadcast.runAt * 1000) : undefined,
        delay: broadcast.delay,
      })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
      .returning()
    if (result.length === 0) {
      return
    }
    if (broadcast.runAt) {
      await tx.execute(sql.raw(UNSCHEDULE_INVOKE))
      const invokeNextBroadcast = invokeBroadcastCron(broadcast.runAt * 1000)
      await tx.execute(sql.raw(invokeNextBroadcast))
    }
    return convertToUpcomingBroadcast(result[0])
  })
}

const reconcileTwilioStatus = async (broadcastID: number) => {
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
        eq(broadcastSentMessageStatus.broadcastId, broadcastID),
        eq(broadcastSentMessageStatus.closed, false),
        isNull(broadcastSentMessageStatus.twilioId),
        eq(broadcastSentMessageStatus.twilioSentStatus, 'delivered'),
      ))
      .limit(CHUNK_SIZE)
      .execute()

    if (failedStatusConversations.length === 0) {
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_POST_INVOKE))
      await supabase.execute(sql.raw(UNSCHEDULE_DELAY_SEND_POST))
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
            log.error(`Failed to get message ${conversation.missive_id} after ${MAX_RETRIES} attempts.`)
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
        log.info(
          `Successfully updated broadcastSentMessageStatus for ${conversation.missive_id}. Data: ${
            JSON.stringify(updateData)
          }`,
        )
        await sleep(MISSIVE_API_RATE_LIMIT)
      }
    }
  } catch (error) {
    log.error(`Error fetching failed conversations for broadcast ID ${broadcastID}: ${error.toString()}`)
    DenoSentry.captureException(error)
  }
}

const handleFailedDeliveries = async () => {
  const MAX_RUN_TIME = 6 * 60 * 1000
  const startTime = Date.now()

  const failedDelivers = await supabase.execute(sql.raw(FAILED_DELIVERED_QUERY))
  if (!failedDelivers || failedDelivers.length === 0) {
    try {
      await supabase.execute(sql.raw(UNSCHEDULE_HANDLE_FAILED_DELIVERIES))
    } catch (e) {
      log.error(`Failed to unschedule handleFailedDeliveries: ${e}`)
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
    log.error('Closing label ID not found. Aborting.')
    DenoSentry.captureException('Closing label ID not found. Aborting.')
    return
  }

  let conversationsToUpdate = []
  let phonesToUpdate = []
  for (const conversation of failedDelivers) {
    try {
      await MissiveUtils.createPost(conversation.missive_conversation_id, postErrorMessages, closingLabelId)
      log.info(`Successfully unsubscribe ${conversation.phone_number}.`)
    } catch (error) {
      log.error(`Failed to create post when handleFailedDeliveries: ${error}`)
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
      log.info(`Approaching time limit. Processed ${conversationsToUpdate.length} conversations. Stopping.`)
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

/* ======================================== UTILS ======================================== */

const makeNextBroadcastSchedule = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  previousBroadcast: Broadcast & { broadcastToSegments: { segment: AudienceSegment; ratio: number }[] },
): Promise<void> => {
  const newBroadcast = convertToFutureBroadcast(previousBroadcast)
  const invokeNextBroadcast = invokeBroadcastCron(newBroadcast.runAt)
  await tx.execute(sql.raw(invokeNextBroadcast))
  const insertedIds: {
    id: number
  }[] = await tx.insert(broadcasts).values(newBroadcast).returning({ id: broadcasts.id })
  await tx.insert(broadcastsSegments).values(previousBroadcast.broadcastToSegments.map((broadcastSegment) => ({
    broadcastId: insertedIds[0].id!,
    segmentId: broadcastSegment.segment.id!,
    ratio: broadcastSegment.ratio,
  })))
}

const insertBroadcastSegmentRecipients = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
) => {
  // every user receives 2 messages
  const limit = Math.floor(broadcastSegment.ratio * nextBroadcast.noUsers! / 100)
  const statement = insertOutgoingMessagesQuery(broadcastSegment, nextBroadcast, limit)
  await tx.execute(sql.raw(statement))
}

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(sql.raw(SELECT_JOB_NAMES))
  return jobs.some((job: { jobname: string }) => job.jobname != 'invoke-broadcast' && JOB_NAMES.includes(job.jobname))
}

const updateSubscriptionStatus = async (
  conversationId: string,
  phoneNumber: string,
  isUnsubscribe: boolean,
  authorName: string,
) => {
  await supabase
    .update(authors)
    .set({ unsubscribed: isUnsubscribe })
    .where(eq(authors.phoneNumber, phoneNumber))

  const action = isUnsubscribe ? 'unsubscribed' : 'resubscribed'
  const postMessage = `This phone number ${phoneNumber} has now been ${action} by ${authorName}.`

  try {
    await MissiveUtils.createPost(conversationId, postMessage)
  } catch (error) {
    log.error(`Failed to create post: ${error}`)
    throw new SystemError('Failed to update subscription status and create post.')
  }
}

export default {
  makeBroadcast,
  getAll,
  patch,
  sendBroadcastFirstMessage,
  sendBroadcastSecondMessage,
  sendNow,
  reconcileTwilioStatus,
  updateSubscriptionStatus,
  handleFailedDeliveries,
} as const
