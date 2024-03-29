import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import * as log from 'log'
import supabase, { sendMostRecentBroadcastDetail } from '../lib/supabase.ts'
import DateUtils from '../misc/DateUtils.ts'
import {
  AudienceSegment,
  Broadcast,
  BroadcastMessageStatus,
  broadcasts,
  BroadcastSegment,
  broadcastSentMessageStatus,
  broadcastsSegments,
  OutgoingMessage,
  outgoingMessages,
} from '../drizzle/schema.ts'
import SystemError from '../exception/SystemError.ts'
import {
  invokeBroadcastCron,
  sendFirstMessagesCron,
  sendSecondMessagesCron,
  UNSCHEDULE_SEND_FIRST_MESSAGES,
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
  TwilioMessage,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import MissiveUtils from '../lib/Missive.ts'
import { sleep } from '../misc/utils.ts'
import Twilio from '../lib/Twilio.ts'
import { ProcessedItem } from './types.ts'
import {
  BroadcastDashBoardQueryReturn,
  insertOutgoingMessagesQuery,
  selectBroadcastDashboard,
  updateTwilioStatusRaw,
} from '../scheduledcron/queries.ts'
import RouteError from '../exception/RouteError.ts'

const makeBroadcast = async (): Promise<void> => {
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
    throw new RouteError(400, 'Unable to retrieve the next broadcast.')
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    throw new SystemError(`Broadcast has no associated segment. Data: ${JSON.stringify(nextBroadcast)}`)
  }
  const insertWaitList: Promise<void>[] = []
  for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
    const insertWait = insertBroadcastSegmentRecipients(
      broadcastSegment,
      nextBroadcast,
    )
    insertWaitList.push(insertWait)
  }
  // Each segment is an independent entity; one failure doesn't affect the others.
  await Promise.all([
    ...insertWaitList,
    makeTomorrowBroadcastSchedule(nextBroadcast),
  ])

  await supabase.execute(sql.raw(sendFirstMessagesCron(nextBroadcast.id)))
  await supabase.update(broadcasts).set({ editable: false }).where(eq(broadcasts.id, nextBroadcast.id))
}

const sendBroadcastSecondMessage = async (broadcastID: number) => {
  // This function is called by a CRON job every minute
  const startTime = Date.now()
  const allIdsMarkedAsProcess: number[] = []
  // Due to Missive API limit, we can only send 5 concurrent requests at any given time
  const processed: ProcessedItem[] = []
  for (let i = 0; i < 10; i++) {
    const loopStartTime = Date.now()
    const results = await supabase.select().from(outgoingMessages).where(
      and(
        eq(outgoingMessages.broadcastId, broadcastID),
        eq(outgoingMessages.isSecond, true),
        eq(outgoingMessages.processed, false),
      ),
    ).orderBy(outgoingMessages.id).limit(5)

    if (results.length === 0) {
      // No messages found, unschedule CRON jobs
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_INVOKE))
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_MESSAGES))
      await supabase.execute(sql.raw(unscheduleTwilioStatus(3)))
      break
    }
    const idsToMarkAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id!)
    // Temporarily mark these messages as processed, so later requests don't pick them up
    await supabase.update(outgoingMessages).set({ processed: true }).where(
      inArray(outgoingMessages.id, idsToMarkAsProcessed),
    )
    allIdsMarkedAsProcess.push(...idsToMarkAsProcessed)
    const missiveResponses = results.map(async (outgoing: OutgoingMessage) => {
      const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
      return ({ response, outgoing })
    })
    Promise.allSettled(missiveResponses).then(async (results) => {
      for (const result of results) {
        // TODO: check if result is PromiseRejectedResult
        if (result.status === 'fulfilled') {
          const { response, outgoing } = result.value
          if (response.ok) {
            const responseBody = await response.json()
            const { id, conversation } = responseBody.drafts
            processed.push({
              outgoing: outgoing,
              id,
              conversation,
            })
          } else {
            log.error('Failed to send broadcast second messages. Broadcast id: ', broadcastID, outgoing)
            // TODO: Not sure what to do here.
          }
        } else {
          log.error('Failed to send broadcast second messages. Broadcast id: ', broadcastID)
          // TODO: Not sure what to do here.
        }
      }
    })
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached. Exiting loop.')
      break
    }
    // Simulate randomness
    if (Math.random() < 0.5) sendMostRecentBroadcastDetail({ totalSecondSent: processed.length })
    await sleep(Math.max(0, 5000 - (Date.now() - loopStartTime)))
  }

  sendMostRecentBroadcastDetail({ totalSecondSent: processed.length })
  await postSendBroadcastMessage(processed, allIdsMarkedAsProcess)
}

const sendBroadcastFirstMessage = async (broadcastID: number) => {
  // This function is called by a CRON job every minute
  const startTime = Date.now()
  const results = await supabase.select().from(outgoingMessages).where(
    and(
      eq(outgoingMessages.broadcastId, broadcastID),
      eq(outgoingMessages.isSecond, false),
      eq(outgoingMessages.processed, false),
    ),
  ).orderBy(outgoingMessages.id).limit(50) // API limit of 1 request per second

  if (results.length === 0) {
    // No messages found, finished sending first messages
    await supabase.execute(sql.raw(sendSecondMessagesCron(startTime, broadcastID, 1))) // TODO: replace 5 with delay
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_FIRST_MESSAGES))
    await supabase.execute(sql.raw(updateTwilioStatusCron(broadcastID)))
    return
  }
  const idsMarkedAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id!)
  // Temporarily mark these messages as processed, so later requests don't pick them up
  await supabase.update(outgoingMessages).set({ processed: true }).where(
    inArray(outgoingMessages.id, idsMarkedAsProcessed),
  )

  const processed: ProcessedItem[] = []
  for (const outgoing of results) {
    const loopStartTime = Date.now()
    const response = await MissiveUtils.sendMessage(outgoing.message, outgoing.recipientPhoneNumber)
    if (response.ok) {
      const responseBody = await response.json()
      const { id, conversation } = responseBody.drafts
      processed.push({
        outgoing: outgoing,
        id,
        conversation,
      })
    } else {
      log.error('Failed to send broadcast first message. Broadcast id: ', broadcastID)
      // TODO: Saved to DB
      // TODO: Not sure what to do here.
    }
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.info('Hard limit reached. Exiting loop.')
      break
    }
    // Simulate randomness
    if (Math.random() < 0.5) sendMostRecentBroadcastDetail({ totalFirstSent: processed.length })
    // Wait for 1s, considering the time spent in API call and other operations
    await sleep(Math.max(0, 1000 - (Date.now() - loopStartTime)))
  }

  sendMostRecentBroadcastDetail({ totalFirstSent: processed.length })
  await postSendBroadcastMessage(processed, idsMarkedAsProcessed)
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
    // await slack({ "failureDetails": "No upcoming broadcast scheduled in data" }); // TODO add slack credential
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
  const result: Broadcast[] = await supabase.update(broadcasts)
    .set({
      firstMessage: broadcast.firstMessage,
      secondMessage: broadcast.secondMessage,
      runAt: broadcast.runAt ? new Date(broadcast.runAt * 1000) : undefined,
      delay: broadcast.delay,
    })
    .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
    .returning()
  if (result.length === 0) return
  return convertToUpcomingBroadcast(result[0])
}

const updateTwilioHistory = async (broadcastID: number) => {
  const broadcast: Broadcast[] = await supabase.select().from(broadcasts).where(eq(broadcasts.id, broadcastID))
  if (broadcast.length === 0) return
  let updatedArray: TwilioMessage[] = []
  const response = await Twilio.getTwilioMessages(broadcast[0].twilioPaging, broadcast[0].runAt)

  if (response.ok) {
    const data = await response.json()
    updatedArray = data.messages.map((message: TwilioMessage) =>
      `('${message.status}'::twilio_status, '${message.sid}'::text, '${message.date_sent}'::timestamptz, '${message.to}'::text, ${broadcastID}::int8, '${
        message.body.replace(/'/g, "''")
      }'::text)`
    )
    if (data.next_page_uri) {
      await supabase.update(broadcasts)
        .set({ twilioPaging: data.next_page_uri })
        .where(eq(broadcasts.id, broadcastID))
    }
  } else {
    log.error('Failed to fetch twilio messages. Broadcast id: ', broadcastID)
    // await slack({ "failureDetails": e });
    return
  }

  if (updatedArray.length > 0) {
    const updateRaw = updateTwilioStatusRaw(updatedArray)
    await supabase.execute(sql.raw(updateRaw))
    // Send realtime update to the sidebar
    const selectQuery = selectBroadcastDashboard(1, undefined, broadcastID)
    const result: BroadcastDashBoardQueryReturn[] = await supabase.execute(sql.raw(selectQuery))
    const payload: BroadcastSentDetail = {
      totalFirstSent: Number(result[0].totalFirstSent),
      totalSecondSent: Number(result[0].totalSecondSent),
      successfullyDelivered: Number(result[0].successfullyDelivered),
      failedDelivered: Number(result[0].failedDelivered),
      totalUnsubscribed: Number(result[0].totalUnsubscribed),
    }
    sendMostRecentBroadcastDetail(payload)
  }
}

/* ======================================== UTILS ======================================== */

const makeTomorrowBroadcastSchedule = async (
  previousBroadcast: Broadcast & {
    broadcastToSegments: { segment: AudienceSegment; ratio: number }[]
  },
): Promise<void> => {
  let noAdvancedDate = 1
  switch (previousBroadcast.runAt.getDay() + 1) {
    case 6: // Tomorrow is Saturday
      noAdvancedDate = 3
      break
    case 0: // Tomorrow is Sunday
      noAdvancedDate = 2
      break
  }

  previousBroadcast.runAt.setUTCDate(previousBroadcast.runAt.getDate() + noAdvancedDate)
  const newBroadcast = convertToFutureBroadcast(previousBroadcast)
  const firstMessageCron = invokeBroadcastCron(newBroadcast.runAt)
  await supabase.execute(sql.raw(firstMessageCron))
  const insertedIds: {
    id: number
  }[] = await supabase.insert(broadcasts).values(newBroadcast).returning({ id: broadcasts.id })
  await supabase.insert(broadcastsSegments).values(previousBroadcast.broadcastToSegments.map((broadcastSegment) => ({
    broadcastId: insertedIds[0].id!,
    segmentId: broadcastSegment.segment.id!,
    ratio: broadcastSegment.ratio,
  })))
}

const insertBroadcastSegmentRecipients = async (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
) => {
  // every user receives 2 messages

  const limit = Math.floor(broadcastSegment.ratio * nextBroadcast.noUsers! / 100)
  const statement = insertOutgoingMessagesQuery(broadcastSegment, nextBroadcast, limit)
  await supabase.execute(sql.raw(statement))
}

const postSendBroadcastMessage = async (processed: ProcessedItem[], idsMarkedAsProcessed: number[]) => {
  if (processed.length !== 0) {
    const outgoingIDsToDelete: number[] = []
    const sentMessageStatuses: BroadcastMessageStatus[] = []
    for (const item of processed) {
      outgoingIDsToDelete.push(item.outgoing.id!)
      sentMessageStatuses.push(convertToBroadcastMessagesStatus(item.outgoing, item.id, item.conversation))
    }
    await supabase.insert(broadcastSentMessageStatus).values(sentMessageStatuses)
    await supabase
      .delete(outgoingMessages)
      .where(inArray(outgoingMessages.id, outgoingIDsToDelete))
  }
  // Messages failed to send, we need to reprocess them
  const idsToUpdate = idsMarkedAsProcessed
    .filter((id: number) => !processed.some((item) => item.outgoing.id === id))
  // Give these messages back to the pool
  if (idsToUpdate.length > 0) {
    await supabase.update(outgoingMessages).set({ processed: false }).where(inArray(outgoingMessages.id, idsToUpdate))
  }
}

export default {
  makeBroadcast,
  getAll,
  patch,
  sendBroadcastFirstMessage,
  sendBroadcastSecondMessage,
  updateTwilioHistory,
} as const
