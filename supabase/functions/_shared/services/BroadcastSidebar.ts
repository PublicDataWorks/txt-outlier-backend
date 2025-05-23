import { and, desc, eq, sql } from 'drizzle-orm'

import DateUtils from '../misc/DateUtils.ts'
import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from '../dto/BroadcastRequestResponse.ts'
import supabase from '../lib/supabase.ts'
import { authors, Broadcast, broadcasts, messageStatuses } from '../drizzle/schema.ts'
import { BroadcastDashBoardQueryReturn, pgmqDelete, selectBroadcastDashboard } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import { SECOND_MESSAGES_QUEUE_NAME } from '../constants.ts'
import DubLinkShortener from '../lib/DubLinkShortener.ts'

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
    // If upcoming broadcast is not paused, get runAt from settings
    response.upcoming.runAt = await DateUtils.calculateNextScheduledTime()
  }
  const lastRunAt = results[results.length - 1].runAt?.getTime()
  if (lastRunAt) {
    response.currentCursor = Math.max(Math.floor(lastRunAt / 1000) - 1, 0)
  } else if (response?.upcoming?.runAt) {
    // Handle case where there's only one upcoming broadcast that hasn't been paused (no run_at in database)
    // In this case, runAt was calculated from broadcast_settings
    response.currentCursor = response.upcoming.runAt - 1
  }
  return response
}

const patch = async (
  id: number,
  broadcast: BroadcastUpdate,
): Promise<UpcomingBroadcastResponse | undefined> => {
  const originalFirstMessage = broadcast.firstMessage
  const originalSecondMessage = broadcast.secondMessage

  // Process the messages with URL shortening
  if (broadcast.firstMessage) {
    const [processedMessage, messageChanged] = await DubLinkShortener.shortenLinksInMessage(broadcast.firstMessage, id)
    if (messageChanged) broadcast.firstMessage = processedMessage
  }
  if (broadcast.secondMessage) {
    const [processedMessage, messageChanged] = await DubLinkShortener.shortenLinksInMessage(broadcast.secondMessage, id)
    if (messageChanged) broadcast.secondMessage = processedMessage
  }

  return await supabase.transaction(async (tx) => {
    const result: Broadcast[] = await tx.update(broadcasts)
      .set({
        firstMessage: broadcast.firstMessage,
        secondMessage: broadcast.secondMessage,
        originalFirstMessage: originalFirstMessage,
        originalSecondMessage: originalSecondMessage,
        runAt: broadcast.runAt ? new Date(broadcast.runAt * 1000) : undefined,
        delay: broadcast.delay,
        noUsers: broadcast.noRecipients,
      })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
      .returning()
    if (result.length === 0) {
      return
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
    .from(messageStatuses)
    .where(
      and(
        eq(messageStatuses.recipientPhoneNumber, phoneNumber),
        eq(messageStatuses.isSecond, false),
      ),
    )
    .orderBy(desc(messageStatuses.id))
    .limit(1)
  if (sentMessage.length > 0 && sentMessage[0].secondMessageQueueId) {
    await supabase.execute(
      pgmqDelete(SECOND_MESSAGES_QUEUE_NAME, String(sentMessage[0].secondMessageQueueId)),
    )
  }
}
export default { getAll, patch, updateSubscriptionStatus, removeBroadcastSecondMessage }
