import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core/session'
import * as log from 'log'

import supabase from '../lib/supabase.ts'
import {
  Broadcast,
  BroadcastMessageStatus,
  broadcasts,
  BroadcastSegment,
  broadcastSentMessageStatus,
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
  UNSCHEDULE_TWILIO_STATUS_UPDATE,
  updateTwilioStatusCron,
  updateTwilioStatusRaw,
} from '../scheduledcron/cron.ts'
import {
  BroadcastResponse,
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
import { getTwilioMessages } from '../lib/twilio.ts'

const makeBroadcast = async () => {
  const nextBroadcast = await supabase.query.broadcasts.findFirst({
    where: and(
      eq(broadcasts.editable, true),
      lt(broadcasts.runAt, advance(24 * 60 * 60 * 1000)), // TODO: Prevent making 2 broadcast in a day
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
    throw new SystemError('Unable to retrieve the next broadcast.')
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    throw new SystemError(
      `Invalid broadcast. Data: ${JSON.stringify(nextBroadcast)}`,
    )
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
  await supabase.update(broadcasts).set({ editable: false }).where(
    eq(broadcasts.id, nextBroadcast.id),
  )
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
      // No messages found, time to unschedule cron that set to run every minute
      const updateStatusCron = updateTwilioStatusCron(broadcastID)
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_INVOKE))
      await supabase.execute(sql.raw(updateStatusCron))
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_MESSAGES))
      // TODO: Delete all rows of outgoing messages
      return
    }
    const idsToMarkAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id)
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
        const { response, outgoing } = result.value
        if (response.ok) {
          const responseBody = await response.json()
          const { id, conversation } = responseBody.drafts
          processed.push({
            outgoing: outgoing,
            id,
            conversation,
          })
        } else log.error(response)
      }
    })
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.error('Hard limit reached. Exiting loop.')
      break
    }
    await sleep(Math.max(0, 5000 - (Date.now() - loopStartTime)))
  }

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
    // No messages found, time to unschedule cron that set to run every minute
    await supabase.execute(sql.raw(sendSecondMessagesCron(startTime, broadcastID, 5))) // TODO: replace 5 with delay
    await supabase.execute(sql.raw(UNSCHEDULE_SEND_FIRST_MESSAGES))
    return
  }
  const idsMarkedAsProcessed = results.map((outgoing: OutgoingMessage) => outgoing.id)
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
      log.error(response)
      // TODO: Saved to DB
    }
    const elapsedTime = Date.now() - startTime
    // We break because CRON job will run every minute, next time it will pick up the remaining messages
    if (elapsedTime >= 60000) {
      log.error('Hard limit reached. Exiting loop.')
      break
    }
    // Wait for 1s, considering the time spent in API call and other operations
    await sleep(Math.max(0, 1000 - (Date.now() - loopStartTime)))
  }
  await postSendBroadcastMessage(processed, idsMarkedAsProcessed)
}
const getAll = async (
  limit = 5, // Limit past batches
  cursor?: number,
): Promise<BroadcastResponse> => {
  let results: Broadcast[] = []
  if (cursor) {
    results = await supabase.query.broadcasts.findMany({
      where: lt(broadcasts.runAt, new Date(cursor * 1000)),
      limit: limit,
      orderBy: [desc(broadcasts.runAt)],
    })
  } else {
    results = await supabase.query.broadcasts.findMany(
      {
        limit: limit + 1,
        orderBy: [desc(broadcasts.runAt)],
      },
    )
  }

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
    .returning(broadcasts)
  if (result.length === 0) return
  return convertToUpcomingBroadcast(result[0])
}

const updateTwilioHistory = async (broadcastID: number) => {
  const broadcast: Broadcast[] = await supabase.select().from(broadcasts).where(
    eq(broadcasts.id, broadcastID),
  )
  if (broadcast.length === 0) {
    return
  }

  let updatedArray: TwilioMessage[] = []
  const response = await getTwilioMessages(
    broadcast[0].twilioPaging,
    broadcast[0].runAt,
  )

  if (response.ok) {
    const data = await response.json()
    updatedArray = data.messages.map((message: TwilioMessage) => {
      return `('${message.status}'::twilio_status, '${message.sid}'::text, '${message.date_sent}'::timestamptz, '${message.to}'::text, ${broadcastID}::int8, '${message.body}'::text)`
    })
    await supabase.update(broadcasts)
      .set({ twilioPaging: data.next_page_uri })
      .where(eq(broadcasts.id, broadcastID))
  } else {
    console.error(
      'Failed to fetch messages:',
      response.status,
      response.statusText,
    )
    // await slack({ "failureDetails": e });
    return
  }

  if (updatedArray.length > 0) {
    const updateRaw = updateTwilioStatusRaw(updatedArray)
    await supabase.execute(sql.raw(updateRaw))
  } else if (!broadcast[0].twilioPaging) {
    await supabase.execute(sql.raw(UNSCHEDULE_TWILIO_STATUS_UPDATE))
  }
}

/* ======================================== UTILS ======================================== */
const makeTomorrowBroadcastSchedule = async (previousBroadcast: Broadcast) => {
  let noAdvancedDate = 1
  switch (previousBroadcast.runAt.getDay() + 1) {
    case 6: // Tomorrow is Saturday
      noAdvancedDate = 3
      break
    case 0: // Tomorrow is Sunday
      noAdvancedDate = 2
      break
  }

  previousBroadcast.runAt.setUTCDate(
    previousBroadcast.runAt.getDate() + noAdvancedDate,
  )
  const newBroadcast = convertToFutureBroadcast(previousBroadcast)
  const firstMessageCron = invokeBroadcastCron(newBroadcast.runAt)
  await supabase.execute(sql.raw(firstMessageCron))
  return supabase.insert(broadcasts).values(newBroadcast)
}

const insertBroadcastSegmentRecipients = async (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
) => {
  // every user receives 2 messages
  const messages = [
    { message: nextBroadcast.firstMessage },
    { message: nextBroadcast.secondMessage },
  ]
  const limit = Math.floor(
    broadcastSegment.ratio * nextBroadcast.noUsers! / 100,
  )
  try {
    await supabase.transaction(async (tx: PgTransaction) => {
      for (const outgoing of messages) {
        const statement = `
          INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id, segment_id, message, is_second)
          SELECT DISTINCT ON (phone_number) phone_number                                            AS recipient_phone_number,
                                            '${nextBroadcast.id}'                                   AS broadcast_id,
                                            '${broadcastSegment.segment.id}'                        AS segment_id,
                                            '${outgoing.message}'                                   AS message,
                                            '${(outgoing.message ===
          nextBroadcast.secondMessage)}' AS isSecond
          FROM (${broadcastSegment.segment.query}) AS foo
          LIMIT ${limit}
        `
        await tx.execute(sql.raw(statement))
      }
    })
  } catch (e) {
    log.error(e) // TODO: setup log properly
    // await slack({ "failureDetails": e });
  }
}

const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

const postSendBroadcastMessage = async (processed: ProcessedItem[], idsMarkedAsProcessed: number[]) => {
  if (processed.length !== 0) {
    const sentMessageStatuses: BroadcastMessageStatus[] = []
    for (const item of processed) {
      sentMessageStatuses.push(convertToBroadcastMessagesStatus(item.outgoing, item.id, item.conversation))
    }
    await supabase.insert(broadcastSentMessageStatus).values(sentMessageStatuses)
  }
  // Messages failed to send, we need to reprocess them
  const idsToUpdate = idsMarkedAsProcessed
    .filter((id: number) => !processed.some((item) => item.outgoing.id === id))
  // Give these messages back to the pool
  if (idsToUpdate.length > 0) {
    await supabase.update(outgoingMessages).set({ processed: false }).where(inArray(outgoingMessages.id, idsToUpdate))
  }
}

/* ======================================== TYPES ======================================== */

interface ProcessedItem {
  outgoing: OutgoingMessage
  id: string
  conversation: string
}

export default {
  make: makeBroadcast,
  getAll,
  patch,
  sendBroadcastFirstMessage,
  sendBroadcastSecondMessage,
  updateTwilioHistory,
} as const
