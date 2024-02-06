import { faker } from 'faker'
import { Broadcast, broadcasts } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createBroadcast = async (noUsers = 10, runAt?: Date): Promise<Broadcast> => {
  const broadcast = {
    runAt: runAt || new Date(),
    delay: '00:10:00',
    noUsers,
    firstMessage: faker.lorem.sentence(),
    secondMessage: faker.lorem.sentence(),
  }
  const results = await supabase.insert(broadcasts).values(broadcast).returning()
  return results[0]
}

export { createBroadcast }
