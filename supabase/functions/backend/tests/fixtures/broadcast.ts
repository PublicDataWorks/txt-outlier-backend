import { faker } from 'faker'
import { Broadcast, broadcasts } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createBroadcast = async (
  noUsers = 10,
  runAt?: Date,
  firstMessage?: string,
  secondMessage?: string,
  editable?: boolean,
): Promise<Broadcast> => {
  const broadcast = {
    runAt: runAt || new Date(),
    delay: '00:10:00',
    noUsers,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage: secondMessage || faker.lorem.sentence(),
    editable: editable ? editable : !runAt,
  }
  const results = await supabase.insert(broadcasts).values(broadcast)
    .returning()
  return results[0]
}

export { createBroadcast }
