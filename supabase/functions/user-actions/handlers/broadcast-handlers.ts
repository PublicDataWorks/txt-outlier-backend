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

const UNSUBSCRIBED_TERMS = ['stop', 'unsubscribe']
const START_TERMS = ['start']

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
        await Missive.createPost(conversationId, `This phone number ${phoneNumber} has now been unsubscribed`)
      }
    }
  } catch (error) {
    console.error(`Failed to update subscription status for ${phoneNumber}:`, error)
    throw error
  }
}

const handleBroadcastReply = async (requestBody: RequestBody) => {
  try {
    const requestMessage = requestBody.message!
    const phoneNumber = requestMessage.from_field.id
    const deliveredDate = new Date(requestMessage.delivered_at * 1000)

    const sentMessage = await findRecentBroadcastOrCampaignMessage(phoneNumber, deliveredDate)
    if (sentMessage.length > 0) {
      await supabase
        .update(twilioMessages)
        .set({
          isReply: true,
          replyToBroadcast: sentMessage[0].broadcastId || sentMessage[0].campaignId,
          replyToCampaign: sentMessage[0].broadcastId || sentMessage[0].campaignId,
        })
        .where(eq(twilioMessages.id, requestMessage.id))

      // Handle second message queue deletion if exists
      if (sentMessage[0].secondMessageQueueId) {
        await supabase.execute(
          pgmqDelete(SECOND_MESSAGES_QUEUE_NAME, String(sentMessage[0].secondMessageQueueId)),
        )
      }
    }

    const messageContent = requestMessage.preview.trim().toLowerCase()

    if (UNSUBSCRIBED_TERMS.some((term) => messageContent.includes(term))) {
      await updateSubscriptionStatus(phoneNumber, true, requestBody.conversation.id, {
        broadcastId: sentMessage[0]?.broadcastId,
        messageId: requestMessage.id,
        sentMessageId: sentMessage[0]?.id,
      })
    } else if (START_TERMS.some((term) => messageContent.includes(term))) {
      await updateSubscriptionStatus(phoneNumber, false)
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
      console.error(`Failed to get message ${message.id}`)
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
