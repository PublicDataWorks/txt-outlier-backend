import { Broadcast, broadcastSentMessageStatus, unsubscribedMessages } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { createTwilioMessages } from './twilioMessage.ts'

const createUnsubscribedMessage = async (
  times = 1,
  broadcastSentMessageStatusId: number[],
  broadcastId: number,
  createdAt?: string,
) => {
  const newUnsubscribedMessages = []

  // Create new Twilio messages
  const newTwilioMessages = await createTwilioMessages(times)

  for (let i = 0; i < times; i++) {
    const message = {
      broadcastId: broadcastId,
      twilioMessageId: newTwilioMessages[i].id,
      replyTo: broadcastSentMessageStatusId[i],
      createdAt,
    }
    newUnsubscribedMessages.push(message)
  }

  return supabase.insert(unsubscribedMessages).values(newUnsubscribedMessages)
    .onConflictDoNothing().returning()
}

export { createUnsubscribedMessage }
