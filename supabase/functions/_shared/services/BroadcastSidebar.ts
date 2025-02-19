import { and, eq, sql, desc } from 'drizzle-orm'
import { Cron } from 'croner'

import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import supabase from '../lib/supabase.ts'
import { authors, Broadcast, broadcasts, broadcastSentMessageStatus, cronJob } from '../drizzle/schema.ts'
import { invokeBroadcastCron } from '../scheduledcron/cron.ts'
import { BroadcastDashBoardQueryReturn, pgmqDelete, selectBroadcastDashboard } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import { SECOND_MESSAGES_QUEUE_NAME } from '../constants.ts'

const getAll = async (
  limit = 5, // Limit past batches
  cursor?: number,
): Promise<BroadcastResponse> => {
  // cursor exists mean we are fetching only past batches, otherwise we are also fetching upcoming batch
  const selectQuery = selectBroadcastDashboard(cursor ? limit : limit + 1, cursor)
  const results: BroadcastDashBoardQueryReturn[] = await supabase.execute(sql.raw(selectQuery))
  if (results.length === 0) {
    return {}
  }
  const response = {} as BroadcastResponse
  for (const broadcast of results) {
    if (broadcast.editable) {
      response.upcoming = convertToUpcomingBroadcast(broadcast)
    } else {
      if (!response.past) {
        response.past = []
      }
      response.past.push(convertToPastBroadcast(broadcast))
    }
  }
  if (response.upcoming && !response.upcoming.runAt) {
    // If upcoming broadcast is not paused, get runAt from cron job
    const [delayJob] = await supabase
      .select({ schedule: cronJob.schedule })
      .from(cronJob)
      .where(eq(cronJob.jobname, 'delay-invoke-broadcast'))
      .limit(1)
    if (delayJob?.schedule) {
      const job = new Cron(delayJob.schedule)
      const nextDate = job.nextRuns(1)
      if (nextDate.length > 0) {
        response.upcoming.runAt = Math.floor(nextDate[0].getTime() / 1000)
      }
    }
  }
  const lastRunAt = results[results.length - 1].runAt?.getTime()
  if (lastRunAt) {
    response.currentCursor = Math.max(Math.floor(lastRunAt / 1000) - 1, 0)
  }
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
        noUsers: broadcast.noRecipients,
      })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
      .returning()
    if (result.length === 0) {
      return
    }
    if (broadcast.runAt) {
      await tx.execute(invokeBroadcastCron(broadcast.runAt * 1000))
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
      pgmqDelete(SECOND_MESSAGES_QUEUE_NAME, String(sentMessage[0].secondMessageQueueId)),
    )
  }
}
export default { getAll, patch, updateSubscriptionStatus, removeBroadcastSecondMessage }
