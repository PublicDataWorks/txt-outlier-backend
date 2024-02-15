import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core/session'
import * as log from 'log'
import supabase from '../lib/supabase.ts'
import { getTwilioMessages } from '../lib/twilio.ts'
import DateUtils from '../misc/DateUtils.ts'
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
  insertOutgoingMessagesQuery,
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
import Missive from '../constants/Missive.ts'

const makeBroadcast = async () => {
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

const sendBroadcastMessage = async (broadcastID: number, useSecond = false) => {
  const startTime = Date.now()
  const results = await supabase.select().from(outgoingMessages).where(
    and(
      eq(outgoingMessages.broadcastId, broadcastID),
      eq(outgoingMessages.isSecond, useSecond),
    ),
  ).orderBy(outgoingMessages.id).limit(50) // API limit of 1 request per second

  if (results.length === 0) {
    // No messages, time to unschedule cron that set to run every minute
    let unschedule: string
    if (useSecond) {
      unschedule = UNSCHEDULE_SEND_SECOND_MESSAGES
      const updateStatusCron = updateTwilioStatusCron(broadcastID)
      await supabase.execute(sql.raw(UNSCHEDULE_SEND_SECOND_INVOKE))
      await supabase.execute(sql.raw(updateStatusCron))
    } else {
      unschedule = UNSCHEDULE_SEND_FIRST_MESSAGES
      await supabase.execute(
        sql.raw(sendSecondMessagesCron(startTime, broadcastID, 5)),
      ) // TODO: replace 5 with delay
    }
    await supabase.execute(sql.raw(unschedule))
  } else {
    const idsToUpdate = results.map((outgoing: OutgoingMessage) => outgoing.id)
    // Temporarily mark these messages as processed, so later requests don't pick them up
    await supabase.update(outgoingMessages).set({ processed: true }).where(
      inArray(outgoingMessages.id, idsToUpdate),
    )
  }

  const processed: {
    outgoing: OutgoingMessage
    id: string // Missive message ID
    conversation: string // Missive conversation ID
  }[] = []
  for (const outgoing of results) {
    const loopStartTime = Date.now()
    const body = {
      drafts: {
        'body': outgoing.message,
        'to_fields': [
          { 'phone_number': outgoing.recipientPhoneNumber },
        ],
        'from_field': {
          'phone_number': '+18336856203', // TODO: Get it from ENV
          'type': 'twilio',
        },
        'send': true, // Send right away
      },
    }

    const response = await fetch(Missive.createMessageUrl, {
      method: 'POST',
      headers: Missive.headers,
      body: JSON.stringify(body),
    })

    if (response.ok) {
      const responseBody = await response.json()
      const { id, conversation } = responseBody.drafts

      processed.push({
        outgoing: outgoing,
        id: id,
        conversation,
      })
    } else {
      log.error(response)
      // TODO: Saved to DB
    }
    const elapsedTime = Date.now() - startTime

    // We break because CRON job will run every minute
    if (elapsedTime >= 60000) {
      log.error('Hard limit reached. Exiting loop.')
      break
    }

    // Wait for 1s, considering the time spent in API call and other operations
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - loopStartTime))))
  }

  if (processed.length !== 0) {
    const outgoingIDsToDelete: number[] = []
    const messageStatusEntries: BroadcastMessageStatus[] = []
    for (const item of processed) {
      outgoingIDsToDelete.push(item.outgoing.id!)
      messageStatusEntries.push(
        convertToBroadcastMessagesStatus(
          item.outgoing,
          item.id,
          item.conversation,
        ),
      )
    }
    await supabase
      .delete(outgoingMessages)
      .where(inArray(outgoingMessages.id, outgoingIDsToDelete))
    await supabase.insert(broadcastSentMessageStatus).values(
      messageStatusEntries,
    )
  }
  const idsToUpdate = results
    .map((outgoing: OutgoingMessage) => outgoing.id)
    .filter((id: number) => !processed.some((item) => item.outgoing.id === id))
  // Give these messages back to the pool
  if (idsToUpdate.length > 0) {
    await supabase.update(outgoingMessages).set({ processed: false }).where(
      inArray(outgoingMessages.id, idsToUpdate),
    )
  }
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
  const limit = Math.floor(broadcastSegment.ratio * nextBroadcast.noUsers! / 100)
  try {
    await supabase.transaction(async (tx: PgTransaction) => {
      for (const outgoing of messages) {
        const statement = insertOutgoingMessagesQuery(
          broadcastSegment,
          nextBroadcast,
          outgoing.message,
          limit,
        )
        await tx.execute(sql.raw(statement))
      }
    })
  } catch (e) {
    log.error(e) // TODO: setup log properly
    // await slack({ "failureDetails": e });
  }
}

export default {
  makeBroadcast,
  getAll,
  patch,
  sendBroadcastMessage,
  updateTwilioHistory,
} as const
