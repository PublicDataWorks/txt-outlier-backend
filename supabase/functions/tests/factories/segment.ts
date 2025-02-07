// test/factories/segment.ts
import { audienceSegments, broadcastsSegments } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const createSegment = async (
  broadcastId?: number,
  ratio = 100,
  name = 'Test',
  description = 'Query for testing',
  query = 'SELECT a.phone_number FROM public.authors a ORDER BY random()',
) => {
  // Create segment
  const [segment] = await supabase
    .insert(audienceSegments)
    .values({
      name,
      description,
      query,
    })
    .returning()

  if (broadcastId) {
    // Create association with broadcast
    await supabase
      .insert(broadcastsSegments)
      .values({
        broadcastId,
        segmentId: segment.id,
        ratio,
        firstMessage: null,
        secondMessage: null,
      })
      .returning()
  }
  return segment
}
