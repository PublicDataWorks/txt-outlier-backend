// broadcast.ts
import { faker } from 'faker'
import { type Broadcast, broadcasts } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import type { CreateBroadcastParams } from './types.ts'

export const createBroadcast = async ({
  noUsers = 10,
  runAt,
  firstMessage,
  secondMessage,
  editable,
}: CreateBroadcastParams = {}): Promise<Broadcast> => {
  const broadcast: Broadcast = {
    runAt: runAt || new Date(),
    delay: 600,
    noUsers,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage: secondMessage || faker.lorem.sentence(),
    editable: editable ?? !runAt,
  }

  const [result] = await supabase
    .insert(broadcasts)
    .values(broadcast)
    .returning()

  return result
}
