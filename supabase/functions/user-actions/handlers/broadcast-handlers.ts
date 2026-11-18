import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { addMinutes } from 'date-fns/index.js'
import { RequestBody } from '../types.ts'
import {
  authors,
  messageStatuses,
  twilioMessages,
  UnsubscribedMessage,
  unsubscribedMessages,
} from '../../_shared/drizzle/schema.ts'
import { delay } from './utils.ts'
import Missive from '../../_shared/lib/Missive.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { SECOND_MESSAGES_QUEUE_NAME } from '../../_shared/constants.ts'
import { pgmqDelete } from '../../_shared/scheduledcron/queries.ts'
import { classifyOptOut } from '../../_shared/misc/subscriptionKeywords.ts'

interface BroadcastMessageUpdate {
  twilioSentAt: Date | null
  twilioId: string | null
  twilioSentStatus: 'delivered' | 'sent' | 'undelivered'
}

const findRecentBroadcastOrCampaignMessage = async (phoneNumber: string, deliveredDate: Date) => {
  const last36Hours = addMinutes(deliveredDate, -36 * 60)
  return await supabase
    .select()
    .from(messageStatuses)
    .where(
      and(
        eq(messageStatuses.recipientPhoneNumber, phoneNumber),
        // @ts-expect-error Type mismatch
        lt(last36Hours.toISOString(), messageStatuses.createdAt),
        // @ts-expect-error Type mismatch
        gt(deliveredDate.toISOString(), messageStatuses.createdAt),
      ),
    )
    .orderBy(desc(messageStatuses.id))
    .limit(1)
}

const updateSubscriptionStatus = async (
  phoneNumber: string,
  unsubscribe: boolean,
  conversationId?: string,
  broadcastInfo?: { broadcastId?: number | null; messageId: string; sentMessageId?: number },
) => {
  try {
    await supabase
      .update(authors)
      .set({ unsubscribed: unsubscribe })
      .where(eq(authors.phoneNumber, phoneNumber))

    if (unsubscribe && broadcastInfo) {
      const newUnsubscribedMessage: UnsubscribedMessage = {
        broadcastId: broadcastInfo.broadcastId,
        twilioMessageId: broadcastInfo.messageId,
        replyTo: broadcastInfo.sentMessageId,
      }
      await supabase.insert(unsubscribedMessages).values(newUnsubscribedMessage)

      if (conversationId) {
        // Label and close the conversation, the same end state Missive's own STOP rule produces. Missive's rule only
        // matches a bare "STOP", so without this a message like "stop texting me" stays open and unlabeled, and the
        // ELSE auto-reply goes out to someone who just opted out.
        const unsubscribedLabelId = Deno.env.get('MISSIVE_UNSUBSCRIBED_LABEL_ID') || undefined
        const response = await Missive.createPost(
          conversationId,
          `This phone number ${phoneNumber} has now been unsubscribed`,
          unsubscribedLabelId,
        )
        if (!response?.ok) {
          console.error(`Failed to post unsubscribe note to conversation ${conversationId}: ${response?.status}`)
        }
      }
    }
  } catch (error) {
    console.error(`Failed to update subscription status for ${phoneNumber}:`, error)
    throw error
  }
}

// For a message that might be an opt-out but isn't clearly one ("how do I stop my water shutoff"), leave the
// resident subscribed and the conversation open, and ask an editor to decide.
const flagPossibleOptOut = async (conversationId: string) => {
  const possibleOptOutLabelId = Deno.env.get('MISSIVE_POSSIBLE_OPTOUT_LABEL_ID') || undefined
  const response = await Missive.createPost(
    conversationId,
    'This message mentions "stop" or "unsubscribe" but may not be an opt-out, so it did not trigger an automatic ' +
      'unsubscribe. If they do want to stop getting texts, comment UNSUBSCRIBE here.',
    possibleOptOutLabelId,
    { close: false },
  )
  if (!response?.ok) {
    console.error(`Failed to post possible opt-out note to conversation ${conversationId}: ${response?.status}`)
  }
}

const handleBroadcastReply = async (requestBody: RequestBody) => {
  try {
    const requestMessage = requestBody.message!
    const phoneNumber = requestMessage.from_field.id
    const deliveredDate = new Date(requestMessage.delivered_at * 1000)

    const sentMessage = await findRecentBroadcastOrCampaignMessage(phoneNumber, deliveredDate)
    if (sentMessage.length > 0) {
      if (sentMessage[0].secondMessageQueueId) {
        await supabase.execute(
          pgmqDelete(SECOND_MESSAGES_QUEUE_NAME, String(sentMessage[0].secondMessageQueueId)),
        )
      }
    }
    const optOut = classifyOptOut(requestMessage.preview)
    if (optOut === 'optout') {
      await updateSubscriptionStatus(phoneNumber, true, requestBody.conversation.id, {
        broadcastId: sentMessage[0]?.broadcastId,
        messageId: requestMessage.id,
        sentMessageId: sentMessage[0]?.id,
      })
    } else {
      if (sentMessage.length > 0) {
        await supabase
          .update(twilioMessages)
          .set({
            isReply: true,
            replyToBroadcast: sentMessage[0].broadcastId,
            replyToCampaign: sentMessage[0].campaignId,
          })
          .where(eq(twilioMessages.id, requestMessage.id))
      }
      if (optOut === 'possible') {
        await flagPossibleOptOut(requestBody.conversation.id)
      }
      // Resubscribing is handled by handleResubscribe, which also posts a note to the conversation.
    }
  } catch (error) {
    console.error('Error handling broadcast reply:', error)
    throw error
  }
}

const handleBroadcastOutgoing = async (requestBody: RequestBody) => {
  try {
    const message = requestBody.message!
    const sentStatus = await supabase
      .select()
      .from(messageStatuses)
      .where(eq(messageStatuses.missiveId, message.id))
      .limit(1)

    if (sentStatus.length === 0) return

    await delay(Math.floor(Math.random() * 1001))

    const response = await Missive.getMissiveMessage(message.id)
    if (!response.ok) {
      console.error(`Failed to get message ${message.id}, ${response.status}`)
      return
    }

    const { messages: missiveMessage } = await response.json()

    const updateData: BroadcastMessageUpdate = missiveMessage.external_id
      ? {
        twilioSentAt: missiveMessage.delivered_at ? new Date(missiveMessage.delivered_at * 1000) : null,
        twilioId: missiveMessage.external_id,
        twilioSentStatus: missiveMessage.delivered_at ? 'delivered' : 'sent',
      }
      : {
        twilioSentAt: null,
        twilioId: null,
        twilioSentStatus: 'undelivered',
      }

    await supabase
      .update(messageStatuses)
      // @ts-expect-error Type mismatch
      .set(updateData)
      .where(eq(messageStatuses.missiveId, message.id))

    console.info(
      `Updated message status for ${message.id}:`,
      JSON.stringify(updateData),
    )
  } catch (error) {
    console.error('Error handling broadcast outgoing:', error)
    throw error
  }
}

export { handleBroadcastOutgoing, handleBroadcastReply }
