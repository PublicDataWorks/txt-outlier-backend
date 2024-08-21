import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import * as log from 'log'
import * as DenoSentry from 'sentry/deno'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import supabase, { sendMostRecentBroadcastDetail } from '../lib/supabase.ts'
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
  invokeBroadcastCron,
  JOB_NAMES,
  SELECT_JOB_NAMES,
  sendFirstMessagesCron,
  sendPostCron,
  sendSecondMessagesCron,
  UNSCHEDULE_INVOKE,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
  UNSCHEDULE_SEND_POST_INVOKE,
  UNSCHEDULE_SEND_SECOND_INVOKE,
  UNSCHEDULE_SEND_SECOND_MESSAGES,
  unscheduleTwilioStatus,
  updateTwilioStatusCron,
} from '../scheduledcron/cron.ts'
import {
  BroadcastResponse,
  BroadcastSentDetail,
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
  insertOutgoingMessagesFallbackQuery,
  insertOutgoingMessagesQuery,
  selectBroadcastDashboard,
} from '../scheduledcron/queries.ts'
import RouteError from '../exception/RouteError.ts'
import { SEND_NOW_STATUS } from '../misc/AppResponse.ts'

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
  // Due to Missive API limit, we can only send 5 concurrent requests at any given time
  for (let i = 0; i < 10; i++) {
    const loopStartTime = Date.now()
    const results = await supabase
      .select()
      .from(outgoingMessages)
      .where(
        and(
          eq(outgoingMessages.broadcastId, broadcastID),
          eq(outgoingMessages.isSecond, true),
        ),
      )
      .orderBy(outgoingMessages.id)
      .limit(5)

    if (results.length === 0) {
      // No messages found, unschedule CRON jobs
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_INVOKE))
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_MESSAGES))
      await supabase.execute(sql.raw(unscheduleTwilioStatus(5)))
      await supabase.execute(sql.raw(sendPostCron(broadcastID)))
      return
    }
    const missiveResponses = results.map(async (outgoing: OutgoingMessage) => {
      const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
      return ({ response, outgoing })
    })
    Promise.allSettled(missiveResponses).then(async (results) => {
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { response, outgoing } = result.value
          if (response.ok) {
            const responseBody = await response.json()
            const { id, conversation } = responseBody.drafts
            // TODO: Can not bulk insert because the webhook service run in parallel to update the status
            await supabase
              .insert(broadcastSentMessageStatus)
              .values(convertToBroadcastMessagesStatus(outgoing, id, conversation))
          } else {
            const errorMessage = `Failed to send broadcast second messages.
              Broadcast id: ${broadcastID}, outgoing: ${outgoing},
              Missive's respond = ${JSON.stringify(await response.json())}`
            log.error(errorMessage)
            DenoSentry.captureException(errorMessage)
          }
        } else {
          log.error(
            `Failed to send broadcast second messages.
            Broadcast id: ${broadcastID}, promise status: ${result.status}, promise result: ${result.reason}`,
          )
        }
      }
    })
    const processIds = results.map((outgoing: OutgoingMessage) => outgoing.id!)
    await supabase
      .delete(outgoingMessages)
      .where(inArray(outgoingMessages.id, processIds))
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached. Exiting loop.')
      break
    }
    await sleep(Math.max(0, 5000 - (Date.now() - loopStartTime)))
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
      ),
    )
    .orderBy(outgoingMessages.id)
    .limit(50) // API limit of 1 request per second

  if (results.length === 0) {
    // No messages found, finished sending first messages
    await supabase.execute(sql.raw(sendSecondMessagesCron(startTime, broadcastID, 1))) // TODO: replace 5 with delay
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_FIRST_MESSAGES))
    await supabase.execute(sql.raw(updateTwilioStatusCron(broadcastID)))
    return
  }

  for (const outgoing of results) {
    const loopStartTime = Date.now()
    const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
    if (response.ok) {
      const responseBody = await response.json()
      const { id, conversation } = responseBody.drafts
      // TODO: Can not bulk insert because the webhook service run in parallel to update the status
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
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached. Exiting loop.')
      break
    }
    // Wait for 1s, considering the time spent in API call and other operations
    await sleep(Math.max(0, 1000 - (Date.now() - loopStartTime)))
  }
  const processedIds = results.map((outgoing: OutgoingMessage) => outgoing.id!)
  await supabase
    .delete(outgoingMessages)
    .where(inArray(outgoingMessages.id, processedIds))
  // We haven't started the updateTwilioHistory cron
  await updateTwilioHistory(broadcastID)
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

// TODO: RENAMEME
const updateTwilioHistory = async (broadcastID: number) => {
  const selectQuery = selectBroadcastDashboard(1, undefined, broadcastID)
  const result: BroadcastDashBoardQueryReturn[] = await supabase.execute(sql.raw(selectQuery))
  if (!result[0]) {
    return
  }
  const payload: BroadcastSentDetail = {
    totalFirstSent: Number(result[0].totalFirstSent),
    totalSecondSent: Number(result[0].totalSecondSent),
    successfullyDelivered: Number(result[0].successfullyDelivered),
    failedDelivered: Number(result[0].failedDelivered),
    totalUnsubscribed: Number(result[0].totalUnsubscribed),
  }
  sendMostRecentBroadcastDetail(payload)
}

const updateFailedToSendConversations = async (broadcastID: number) => {
  const CHUNK_SIZE = 200
  const MISSIVE_API_RATE_LIMIT = 1000
  const MAX_RUN_TIME = 4 * 60 * 1000
  const MAX_RETRIES = 3

  const startTime = Date.now()
  let postErrorMessages = `❌ This message was undeliverable. The phone number has now been unsubscribed. `
  let closingLabelId: string | undefined = undefined

  try {
    let failedConversations = await supabase
      .selectDistinct({
        missive_conversation_id: broadcastSentMessageStatus.missiveConversationId,
        phones: broadcastSentMessageStatus.recipientPhoneNumber,
      })
      .from(broadcastSentMessageStatus)
      .where(and(
        eq(broadcastSentMessageStatus.broadcastId, broadcastID),
        eq(broadcastSentMessageStatus.closed, false),
        ne(broadcastSentMessageStatus.twilioSentStatus, 'delivered'),
        eq(broadcastSentMessageStatus.isSecond, false),
      ))
      .limit(CHUNK_SIZE)
      .execute()

    log.info(`Processing ${failedConversations.length} failed conversations.`)
    if (failedConversations.length === 0) {
      failedConversations = await supabase
        .selectDistinct({
          missive_conversation_id: broadcastSentMessageStatus.missiveConversationId,
          phones: broadcastSentMessageStatus.recipientPhoneNumber,
          missive_id: broadcastSentMessageStatus.missiveId,
        })
        .from(broadcastSentMessageStatus)
        .where(and(
          eq(broadcastSentMessageStatus.broadcastId, broadcastID),
          eq(broadcastSentMessageStatus.closed, false),
          isNull(broadcastSentMessageStatus.twilioSentAt),
          eq(broadcastSentMessageStatus.twilioSentStatus, 'delivered'),
        ))
        .limit(CHUNK_SIZE)
        .execute()

      if (failedConversations.length === 0) {
        await supabase.execute(sql.raw(UNSCHEDULE_SEND_POST_INVOKE))
        await updateTwilioHistory(broadcastID)
        return
      }
      // deno-lint-ignore no-explicit-any
      const conversationsToProcess: any[] = []
      for (const conversation of failedConversations) {
        let retries = 0
        let response
        while (retries < MAX_RETRIES) {
          try {
            response = await MissiveUtils.getMissiveMessage(conversation.missive_conversation_id)
            break
          } catch (_) {
            retries++
            if (retries === MAX_RETRIES) {
              log.error(`Failed to get message ${conversation.missive_conversation_id} after ${MAX_RETRIES} attempts.`)
              break
            }
            await sleep(MISSIVE_API_RATE_LIMIT)
          }
        }

        let updateData = {}
        const missiveMessage = response.messages
        if (missiveMessage.external_id) {
          updateData = {
            twilioSentAt: missiveMessage.delivered_at ? new Date(missiveMessage.delivered_at * 1000) : null,
            twilioId: missiveMessage.external_id,
            twilioSentStatus: missiveMessage.delivered_at ? 'delivered' : 'sent',
          }
        } else {
          updateData = {
            twilioSentAt: null,
            twilioId: null,
            twilioSentStatus: 'undelivered',
          }
          conversationsToProcess.push(conversation)
        }
        await supabase
          .update(broadcastSentMessageStatus)
          .set(updateData)
          .where(eq(broadcastSentMessageStatus.missiveId, conversation.missive_conversation_id))
        log.info(
          `Successfully updated broadcastSentMessageStatus for ${conversation.missive_conversation_id}. Data: ${
            JSON.stringify(updateData)
          }`,
        )

        await sleep(MISSIVE_API_RATE_LIMIT)
      }
      failedConversations = conversationsToProcess
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

    if (errorMessage.length > 0) {
      for (const message of errorMessage) {
        if (message.name === 'missive_broadcast_post_closing_message') {
          postErrorMessages = message.content || postErrorMessages
        } else if (message.name === 'missive_broadcast_post_closing_label_id') {
          closingLabelId = message.content || undefined
        }
      }
    }

    if (!closingLabelId) {
      log.error('Closing label ID not found. Aborting.')
      DenoSentry.captureException('Closing label ID not found. Aborting.')
      return
    }

    const conversationsToUpdate: string[] = []
    const failedPhoneNumbers: string[] = []
    for (const conversation of failedConversations) {
      await MissiveUtils.createPost(conversation.missive_conversation_id, postErrorMessages, closingLabelId)
      conversationsToUpdate.push(conversation.missive_conversation_id)
      failedPhoneNumbers.push(conversation.phones)

      const elapsedTime = Date.now() - startTime
      if (elapsedTime > MAX_RUN_TIME) {
        log.info(`Approaching time limit. Processed ${conversationsToUpdate.length} conversations. Stopping.`)
        break
      }

      await new Promise((resolve) => setTimeout(resolve, MISSIVE_API_RATE_LIMIT))
    }

    if (conversationsToUpdate.length > 0 && failedPhoneNumbers.length > 0) {
      await supabase
        .update(broadcastSentMessageStatus)
        .set({ closed: true })
        .where(and(
          eq(broadcastSentMessageStatus.broadcastId, broadcastID),
          inArray(broadcastSentMessageStatus.missiveConversationId, conversationsToUpdate),
        ))
      await supabase.update(authors)
        .set({ exclude: true })
        .where(inArray(authors.phoneNumber, failedPhoneNumbers))
    }

    log.info(`Processed and updated ${conversationsToUpdate.length} failed conversations.`)

    return conversationsToUpdate.length
  } catch (error) {
    log.error(`Error fetching failed conversations for broadcast ID ${broadcastID}: ${error.toString()}`)
    DenoSentry.captureException(error)
    return
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
  updateTwilioHistory,
  sendNow,
  updateFailedToSendConversations,
  updateSubscriptionStatus,
} as const
