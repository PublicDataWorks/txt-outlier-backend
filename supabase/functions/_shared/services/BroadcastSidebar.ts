import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import supabase from '../lib/supabase.ts'
import { authors, Broadcast, broadcasts } from '../drizzle/schema.ts'
import { and, eq, sql } from 'drizzle-orm'
import { invokeBroadcastCron } from '../scheduledcron/cron.ts'
import { BroadcastDashBoardQueryReturn, selectBroadcastDashboard } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'

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

  try {
    await MissiveUtils.createPost(conversationId, postMessage)
  } catch (error) {
    console.error(`Failed to create post: ${error}`)
    throw new Error('Failed to update subscription status and create post.')
  }
}

export default { getAll, patch, updateSubscriptionStatus }
