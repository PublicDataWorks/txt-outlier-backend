import { and, eq, sql, desc } from 'drizzle-orm'

import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import supabase from '../lib/supabase.ts'
import { authors, Broadcast, broadcasts, broadcastSentMessageStatus } from '../drizzle/schema.ts'
import { invokeBroadcastCron } from '../scheduledcron/cron.ts'
import { BroadcastDashBoardQueryReturn, pgmq_delete, selectBroadcastDashboard } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import { SECOND_MESSAGES_QUEUE_NAME } from '../constants.ts';

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
      const invokeNextBroadcast = invokeBroadcastCron(broadcast.runAt * 1000)
      await tx.execute(sql.raw(invokeNextBroadcast))
    }
    return convertToUpcomingBroadcast(result[0])
  })
}

const updateSubscriptionStatus = async (
  conversationId: string,
  phoneNumber: string,
  isUnsubscribe: boolean,
  authorName?: string,
) => {
  await supabase
    .update(authors)
    .set({ unsubscribed: isUnsubscribe })
    .where(eq(authors.phoneNumber, phoneNumber))

  const action = isUnsubscribe ? 'unsubscribed' : 'resubscribed'
  const byAuthor = authorName ? ` by ${authorName}` : ''
  const postMessage = `This phone number ${phoneNumber} has now been ${action}${byAuthor}.`

  const response = await MissiveUtils.createPost(conversationId, postMessage)
  if (response.ok) {
    console.log(
      `[updateSubscriptionStatus] Successfully created post. conversationId: ${conversationId}, postMessage: ${postMessage}`,
    )
  } else {
    console.error(
      `[updateSubscriptionStatus] Failed to create post. conversationId: ${conversationId}, postMessage: ${postMessage}`,
    )
    throw new Error('Failed to update subscription status and create post.')
  }
}

const removeBroadcastSecondMessage = async (phoneNumber: string) => {
  const sentMessage = await supabase
    .select()
    .from(broadcastSentMessageStatus)
    .where(
      and(
        eq(broadcastSentMessageStatus.recipientPhoneNumber, phoneNumber),
        eq(broadcastSentMessageStatus.isSecond, false),
      ),
    )
    .orderBy(desc(broadcastSentMessageStatus.id))
    .limit(1)
  if (sentMessage.length > 0 && sentMessage[0].secondMessageQueueId) {
    await supabase.execute(
      pgmq_delete(SECOND_MESSAGES_QUEUE_NAME, String(sentMessage[0].secondMessageQueueId)),
    )
  }
}
export default { getAll, patch, updateSubscriptionStatus, removeBroadcastSecondMessage }
