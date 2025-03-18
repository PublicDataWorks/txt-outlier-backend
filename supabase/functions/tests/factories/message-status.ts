import { faker } from 'faker'
import supabase from '../../_shared/lib/supabase.ts'
import { createBroadcast } from './broadcast.ts'
import { createSegment } from './segment.ts'
import { createAuthors } from './author.ts'
import { messageStatuses } from '../../_shared/drizzle/schema.ts'

type CreateBroadcastSentMessageParams = {
  recipient?: string
  broadcastId?: number
  message?: string
  isSecond?: boolean
  twilioSentStatus?: string
  secondMessageQueueId?: number
  createdAt?: string
  twilioId?: string
}

export const createBroadcastMessageStatus = async ({
  isSecond = false,
  broadcastId,
  recipient,
  secondMessageQueueId,
  createdAt,
  twilioId,
  twilioSentStatus,
}: CreateBroadcastSentMessageParams) => {
  const id = broadcastId || (await createBroadcast()).id
  const segment = await createSegment({ broadcastId: id })
  await createAuthors(1, recipient)

  const sentMessage = {
    recipientPhoneNumber: recipient,
    missiveId: faker.random.uuid(),
    missiveConversationId: faker.random.uuid(),
    broadcastId: id,
    isSecond,
    twilioSentStatus: twilioSentStatus || faker.random.arrayElement(['delivered', 'sent', 'undelivered']),
    message: isSecond ? `Second message ${faker.lorem.sentence()}` : `First message ${faker.lorem.sentence()}`,
    audienceSegmentId: segment.id,
    secondMessageQueueId,
    createdAt,
    twilioId,
  }

  const [result] = await supabase
    .insert(messageStatuses)
    // @ts-ignore Type mismatch
    .values(sentMessage)
    .returning()
  return result
}

type CreateCampaignMessageStatusParams = {
  recipientPhoneNumber: string
  campaignId: number
  missiveConversationId: string
  isSecond?: boolean
  twilioSentStatus?: 'delivered' | 'delivery_unknown' | 'undelivered' | 'failed' | 'received' | 'sent'
  message?: string
}

export const createCampaignMessageStatus = async ({
  recipientPhoneNumber,
  campaignId,
  missiveConversationId,
  isSecond = false,
  twilioSentStatus = 'delivered',
  message,
}: CreateCampaignMessageStatusParams) => {
  const [result] = await supabase
    .insert(messageStatuses)
    .values({
      recipientPhoneNumber,
      campaignId,
      missiveId: crypto.randomUUID(),
      missiveConversationId,
      isSecond,
      twilioSentStatus,
      message: message ||
        (isSecond ? `Second message ${faker.lorem.sentence()}` : `First message ${faker.lorem.sentence()}`),
    })
    .returning()

  return result
}
