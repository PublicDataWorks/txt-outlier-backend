import { faker } from 'faker'
import { Broadcast, broadcastSentMessageStatus } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { createAuthors } from './authors.ts'
import { createSegment } from './segment.ts'
import { getRandomDayFromLastWeek } from '../helpers/getRandomDayFromLastWeek.ts'

const createBroadcastStatus = async (times = 1, broadcast: Broadcast) => {
  const newHistories = []
  const newAuthors = await createAuthors(times)
  const segment = await createSegment(1, broadcast.id!)
  for (let i = 0; i < times; i++) {
    const firstHistory = {
      recipientPhoneNumber: newAuthors[i].phoneNumber,
      missiveId: faker.random.uuid(),
      missiveConversationId: faker.random.uuid(),
      broadcastId: broadcast.id,
      isSecond: false,
      twilioSentStatus: 'failed',
      message: broadcast.firstMessage,
      audienceSegmentId: segment.id,
      createdAt: getRandomDayFromLastWeek(),
    }

    const secondHistory = Object.assign({}, firstHistory)
    secondHistory.isSecond = !firstHistory.isSecond
    secondHistory.missiveId = faker.random.uuid()
    secondHistory.message = broadcast.secondMessage
    secondHistory.createdAt = getRandomDayFromLastWeek()
    secondHistory.isSecond = true
    secondHistory.twilioSentStatus = 'failed'
    newHistories.push(firstHistory, secondHistory)
  }
  return supabase.insert(broadcastSentMessageStatus).values(newHistories)
    .returning()
}

export { createBroadcastStatus }
