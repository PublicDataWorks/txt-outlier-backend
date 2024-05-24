import { ConversationLabel, conversationsLabels } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { getRandomDayFromLastWeek } from '../helpers/getRandomDayFromLastWeek.ts'
import { createConversations } from './conversations.ts'
import { createLabels } from './labels.ts'

const createConversationLabels = async (
  times = 1,
  conversationIds = [],
  labelIds = [],
  conversationLabelsOverrides: Partial<ConversationLabel> = {},
) => {
  // If no conversationIds are provided, create new conversations
  if (conversationIds.length === 0) {
    const newConversations = await createConversations(times)
    conversationIds = newConversations.map((conversation) => conversation.id)
  }

  // If no labelIds are provided, create new labels
  if (labelIds.length === 0) {
    const newLabels = await createLabels(times)
    labelIds = newLabels.map((label) => label.id)
  }

  const newConversationLabels = []
  for (let i = 0; i < times; i++) {
    const conversationLabel = {
      // createdAt: new Date().toISOString(),
      conversationId: conversationIds[i % conversationIds.length], // Use existing conversationId
      labelId: labelIds[i % labelIds.length], // Use existing labelId
      ...conversationLabelsOverrides,
      createdAt: getRandomDayFromLastWeek(),
    }
    newConversationLabels.push(conversationLabel)
  }

  return supabase.insert(conversationsLabels).values(newConversationLabels).onConflictDoNothing().returning()
}

export { createConversationLabels }
