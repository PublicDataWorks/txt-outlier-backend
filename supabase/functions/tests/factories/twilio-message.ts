// twilio-message.ts
import { twilioMessages } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type CreateTwilioMessageParams = {
  id?: string
  preview?: string
  type?: string
  deliveredAt?: string
  updatedAt?: string
  references?: string[]
  externalId?: string
  attachments?: string
  fromField: string
  toField: string
  isReply?: boolean
  replyToBroadcast?: number
  replyToCampaign?: number
  senderId?: string
  conversationId?: string
}

export async function createTwilioMessage({
  id,
  preview = 'Message preview',
  type,
  deliveredAt = new Date().toISOString(),
  updatedAt,
  references = [],
  externalId,
  attachments,
  fromField,
  toField,
  isReply = false,
  replyToBroadcast,
  replyToCampaign,
  senderId,
  conversationId,
}: CreateTwilioMessageParams) {
  const [twilioMessage] = await supabase
    .insert(twilioMessages)
    .values({
      id,
      preview,
      type,
      deliveredAt,
      updatedAt,
      references,
      externalId,
      attachments,
      fromField,
      toField,
      isReply,
      replyToBroadcast,
      replyToCampaign,
      senderId,
      conversationId,
    })
    .returning()

  return twilioMessage
}
