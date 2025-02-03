import { faker } from 'faker'
import { audienceSegments, broadcastsSegments } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createSegment = async (times = 1, broadcastId: number, ratio = 20) => {
  const newSegments = []
  for (let i = 0; i < times; i++) {
    const segment = {
      query: `SELECT from_field as phone_number
              FROM twilio_messages
              ORDER BY RANDOM()`,
      description: faker.lorem.sentence(),
    }
    newSegments.push(segment)
  }
  const segments = await supabase.insert(audienceSegments).values(
    newSegments,
  ).onConflictDoNothing().returning()
  const newBroadcastSegments = []
  for (const segment of segments) {
    newBroadcastSegments.push({
      broadcastId,
      segmentId: segment.id,
      ratio,
    })
  }
  await supabase.insert(broadcastsSegments).values(newBroadcastSegments)
    .onConflictDoNothing()
}

export { createSegment }
