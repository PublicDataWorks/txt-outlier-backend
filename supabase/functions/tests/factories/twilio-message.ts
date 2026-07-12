// twilio-message.ts
import { twilioMessages } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type CreateTwilioMessageParams = {
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
}

export async function createTwilioMessage({
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
}: CreateTwilioMessageParams) {
  const [twilioMessage] = await supabase
    .insert(twilioMessages)
    .values({
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
    })
    .returning()

  return twilioMessage
}
