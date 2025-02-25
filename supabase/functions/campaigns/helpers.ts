import { SegmentConfig } from './dto.ts'
import supabase from '../_shared/lib/supabase.ts'
import { inArray } from 'drizzle-orm'
import { labels } from '../_shared/drizzle/schema.ts'

export const getAllSegmentIds = (config: SegmentConfig): string[] => {
  if (typeof config === 'string') {
    return [config]
  }
  return config.flatMap((item) => Array.isArray(item) ? item : [item])
}

export const validateSegments = async (segments: SegmentConfig): Promise<boolean> => {
  const segmentIds = getAllSegmentIds(segments)
  const existingSegments = await supabase
    .select({ id: labels.id })
    .from(labels)
    .where(inArray(labels.id, segmentIds))

  return existingSegments.length === segmentIds.length
}
