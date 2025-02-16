import { audienceSegments, broadcastsSegments } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type CreateSegmentParams = {
  broadcastId?: number
  ratio?: number
  name?: string
  description?: string
  query?: string
}

export const createSegment = async ({
  broadcastId,
  ratio,
  name,
  description,
  query,
}: CreateSegmentParams = {}) => {
  // Create segment
  const [segment] = await supabase
    .insert(audienceSegments)
    .values({
      name: name || 'Test',
      description: description || 'Test description',
      query: query || 'SELECT a.phone_number FROM public.authors a ORDER BY random()',
    })
    .returning()
  if (broadcastId) {
    // Create association with broadcast
    await supabase
      .insert(broadcastsSegments)
      .values({
        broadcastId,
        segmentId: segment.id,
        ratio: ratio || 100,
        firstMessage: null,
        secondMessage: null,
      })
      .returning()
  }
  return segment
}
