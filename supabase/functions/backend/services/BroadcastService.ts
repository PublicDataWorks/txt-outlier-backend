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
  cronJob,
  OutgoingMessage,
  outgoingMessages,
} from '../drizzle/schema.ts'
import SystemError from '../exception/SystemError.ts'
import {
  dateToCron,
  invokeBroadcastCron,
  JOB_NAMES,
  SELECT_JOB_NAMES,
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
import { escapeLiteral } from '../scheduledcron/helpers.ts'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'
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

  await supabase.transaction(async (tx) => {
    for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
      await insertBroadcastSegmentRecipients(tx, broadcastSegment, nextBroadcast)
    }
    await makeTomorrowBroadcastSchedule(tx, nextBroadcast)
    await tx.execute(sql.raw(sendFirstMessagesCron(nextBroadcast.id)))
    await tx.update(broadcasts).set({ editable: false }).where(eq(broadcasts.id, nextBroadcast.id))
  })
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
    throw new SystemError(SEND_NOW_STATUS.Error) //
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    log.error(`SendNow: Broadcast has no associated segment. Data: ${JSON.stringify(nextBroadcast)}`)
    throw new SystemError(SEND_NOW_STATUS.Error)
  }
  const diffInMinutes = DateUtils.diffInMinutes(nextBroadcast.runAt)
  if (0 <= diffInMinutes && diffInMinutes <= 30) {
    log.error('Unable to send now: the next batch is scheduled to send less than 30 minutes from now')
    throw new RouteError(400, SEND_NOW_STATUS.AboutToRun)
  }

  const isRunning = await isBroadcastRunning()
  if (isRunning) {
    log.error(`Unable to send now: another broadcast is running`)
    throw new RouteError(400, SEND_NOW_STATUS.Running)
  }

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

    await tx.update(broadcasts).set({ editable: false, runAt: new Date() }).where(eq(broadcasts.id, nextBroadcast.id))
    await tx.insert(broadcastsSegments).values(newBroadcastSegments)
    await tx.execute(sql.raw(sendFirstMessagesCron(nextBroadcast.id)))
  })
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
      await supabase.execute(sql.raw(unscheduleTwilioStatus(5)))
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
  await supabase.transaction(async (tx) => {
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
      await tx.rollback()
      return
    }
    if (broadcast.runAt) {
      const cronRunAt = dateToCron(new Date(broadcast.runAt * 1000))
      await tx
        .update(cronJob)
        .set({ schedule: cronRunAt })
        .where(eq(cronJob.jobname, 'invoke-broadcast'))
        .execute()
    }
    return convertToUpcomingBroadcast(result[0])
  })
}

const updateTwilioHistory = async (broadcastID: number) => {
  const broadcast: Broadcast[] = await supabase.select().from(broadcasts).where(eq(broadcasts.id, broadcastID))
  if (broadcast.length === 0) return
  let updatedArray: string[] = []
  const response = await Twilio.getTwilioMessages(broadcast[0].twilioPaging, broadcast[0].runAt)

  if (response.ok) {
    const data = await response.json()
    updatedArray = data.messages.map((message: TwilioMessage) =>
      `('${message.status}'::twilio_status, '${message.sid}'::text, '${message.date_sent}'::timestamptz, '${message.to}'::text, ${broadcastID}::int8,
        ${escapeLiteral(message.body)}::text)`
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
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  previousBroadcast: Broadcast & { broadcastToSegments: { segment: AudienceSegment; ratio: number }[] },
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

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(sql.raw(SELECT_JOB_NAMES))
  return jobs.some((job: { jobname: string }) => job.jobname != 'invoke-broadcast' && JOB_NAMES.includes(job.jobname))
}

export default {
  makeBroadcast,
  getAll,
  patch,
  sendBroadcastFirstMessage,
  sendBroadcastSecondMessage,
  updateTwilioHistory,
  sendNow,
} as const
