// broadcast.ts
import { faker } from 'faker'
import { type Broadcast, broadcasts } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export type CreateBroadcastParams = {
  noUsers?: number
  runAt?: Date | null
  firstMessage?: string
  secondMessage?: string
  editable?: boolean
  delay?: number
}

export const createBroadcast = async ({
  noUsers,
  runAt,
  firstMessage,
  secondMessage,
  editable,
}: CreateBroadcastParams = {}): Promise<Broadcast> => {
  const broadcast: Broadcast = {
    runAt: runAt,
    delay: 600,
    noUsers: noUsers || 10,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage: secondMessage || faker.lorem.sentence(),
    editable: editable || false,
  }

  const [result] = await supabase
    .insert(broadcasts)
    .values(broadcast)
    .returning()

  return result
}
