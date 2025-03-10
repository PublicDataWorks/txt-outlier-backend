import { conversationsAuthors } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type CreateConversationAuthorParams = {
  conversationId: string
  authorPhoneNumber: string
}

export async function createConversationAuthor({ conversationId, authorPhoneNumber }: CreateConversationAuthorParams) {
  const [conversationAuthor] = await supabase
    .insert(conversationsAuthors)
    .values({
      conversationId,
      authorPhoneNumber,
    })
    .returning()
  return conversationAuthor
}
