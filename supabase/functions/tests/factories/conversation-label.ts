import { conversationsLabels } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { createConversation } from './conversation.ts'

export type CreateConversationLabelParams = {
  labelId: string
  isArchived?: boolean
  conversationId?: string
}

export const createConversationLabel = async ({
  labelId,
  isArchived = false,
  conversationId,
}: CreateConversationLabelParams) => {
  // Create a conversation if not provided
  const conversation = conversationId ? null : await createConversation()

  const [result] = await supabase
    .insert(conversationsLabels)
    .values({
      labelId,
      isArchived,
      conversationId: conversationId || conversation!.id,
    })
    .returning()

  return result
}
