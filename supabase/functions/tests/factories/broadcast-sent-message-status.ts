import { faker } from 'faker'
import { BroadcastMessageStatus, broadcastSentMessageStatus } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { createBroadcast } from './broadcast.ts'
import { createSegment } from './segment.ts'
import { createAuthors } from './author.ts'

type CreateBroadcastSentMessageParams = {
  recipient?: string
  broadcastId?: number
  message?: string
  isSecond?: boolean
  twilioSentStatus?: string
  secondMessageQueueId?: number
  createdAt?: string
}

export const createBroadcastSentMessageStatus = async ({
  isSecond = false,
  recipient,
  secondMessageQueueId,
  createdAt,
}: CreateBroadcastSentMessageParams) => {
  const broadcast = await createBroadcast()
  const segment = await createSegment(broadcast.id)
  await createAuthors(1, recipient)

  const sentMessage = {
    recipientPhoneNumber: recipient,
    missiveId: faker.random.uuid(),
    missiveConversationId: faker.random.uuid(),
    broadcastId: broadcast.id,
    isSecond,
    twilioSentStatus: faker.random.arrayElement(['delivered', 'sent', 'undelivered']),
    message: isSecond ? `Second message ${faker.lorem.sentence()}` : `First message ${faker.lorem.sentence()}`,
    audienceSegmentId: segment.id,
    secondMessageQueueId,
    createdAt,
  }

  const [result] = await supabase
    .insert(broadcastSentMessageStatus)
    // @ts-expect-error Type mismatch
    .values(sentMessage)
    .returning()
  return result
}

export const createBothBroadcastSentMessageStatus = async (broadcastId = 1) => {
  const first = await createBroadcastSentMessageStatus({ broadcastId, isSecond: false })
  const second = await createBroadcastSentMessageStatus({ broadcastId, isSecond: true })
  return { first, second }
}
