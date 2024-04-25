import { faker } from 'faker'
import { twilioMessages } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { createAuthors } from './authors.ts'

const createTwilioMessages = async (times = 1) => {
  const newMessages = []
  const newAuthors = await createAuthors(times)
  for (let i = 0; i < times; i++) {
    const message = {
      preview: faker.lorem.sentence(),
      type: 'sms',
      deliveredAt: faker.date.past().toISOString(),
      // deliveredAt: '2024-03-19 04:37:00+00',
      references: [],
      fromField: newAuthors[i].phoneNumber,
      toField: (i - 1 >= 0) ? newAuthors[i - 1].phoneNumber : newAuthors[i + 1].phoneNumber,
    }
    newMessages.push(message)
  }
  return supabase.insert(twilioMessages).values(newMessages)
    .onConflictDoNothing().returning()
}

export { createTwilioMessages }
