import { faker } from 'faker'
import { Author, TwilioMessage, twilioMessages } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { createAuthors } from './authors.ts'

const createTwilioMessages = async (times = 1, updatedData?: Partial<TwilioMessage>, authors?: Author[]) => {
  const newMessages = []
  const newAuthors = authors ? authors : await createAuthors(times)
  for (let i = 0; i < times; i++) {
    const message = {
      preview: faker.lorem.sentence(),
      type: 'sms',
      // deliveredAt: faker.date.past().toString(),
      deliveredAt: '2024-03-19 04:37:00+00',
      references: [],
      fromField: newAuthors[i].phoneNumber,
      toField: (i - 1 >= 0) ? newAuthors[i - 1].phoneNumber : newAuthors[i + 1].phoneNumber,
    }
    Object.assign(message, updatedData)
    newMessages.push(message)
  }
  return await supabase.insert(twilioMessages).values(newMessages)
    .onConflictDoNothing().returning()
}

export { createTwilioMessages }
