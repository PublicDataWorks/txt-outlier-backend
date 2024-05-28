import { Conversation, conversations } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { faker } from 'faker'

export const createConversations = async (times = 1, conversationOverrides: Partial<Conversation> = {}) => {
  const newConversations = []
  for (let i = 0; i < times; i++) {
    const conversation = {
      id: faker.random.uuid(),
      createdAt: new Date().toISOString(),
      messagesCount: 0,
      draftsCount: 0,
      sendLaterMessagesCount: 0,
      attachmentsCount: 0,
      tasksCount: 0,
      completedTasksCount: 0,
      webUrl: `http://example.com/${faker.random.uuid()}`,
      appUrl: `app://example.com/${faker.random.uuid()}`,
      ...conversationOverrides,
    }
    newConversations.push(conversation)
  }

  return await supabase.insert(conversations).values(newConversations).returning()
}
