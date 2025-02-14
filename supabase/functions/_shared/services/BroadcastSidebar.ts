import supabase from '../lib/supabase.ts'
import { authors } from '../drizzle/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { BroadcastDashBoardQueryReturn, getBroadcastDetails } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'

const getAll = async (
  limit = 5,
  cursor?: number,
): Promise<BroadcastDashBoardQueryReturn[]> => {
  const selectQuery = getBroadcastDetails(limit, cursor)
  supabase.
  return await supabase.execute(sql.raw(selectQuery))
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

export default { getAll, updateSubscriptionStatus }
