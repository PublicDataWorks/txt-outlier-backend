import { faker } from 'https://deno.land/x/deno_faker@v1.0.3/mod.ts'
import { broadcasts } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createBroadcast = async (noUsers = 10, runAt?: Date) => {
  const broadcast = {
    runAt: runAt || new Date(),
    delay: '00:10:00',
    noUsers,
    firstMessage: faker.lorem.sentence(),
    secondMessage: faker.lorem.sentence(),
  }
  const results = await supabase.insert(broadcasts).values(broadcast)
    .returning()
  return results[0]
}

export { createBroadcast }
