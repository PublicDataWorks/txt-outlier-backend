import supabase from '../_shared/lib/supabase.ts'
import { inArray } from 'drizzle-orm'
import { labels } from '../_shared/drizzle/schema.ts'
import { SegmentConfig } from './dto.ts'

export const getAllSegmentIds = (config: SegmentConfig): string[] => {
  if (typeof config === 'string') {
    return [config]
  }
  return config.flatMap((item) => Array.isArray(item) ? item : [item])
}

export const validateSegments = async (
  includedSegments?: SegmentConfig | null,
  excludedSegments?: SegmentConfig | null,
): Promise<boolean> => {
  const includedIds = includedSegments ? getAllSegmentIds(includedSegments) : []
  const excludedIds = excludedSegments ? getAllSegmentIds(excludedSegments) : []
  const allIds = [...includedIds, ...excludedIds]
  if (allIds.length === 0) {
    return true
  }

  const existingSegments = await supabase
    .select({ id: labels.id })
    .from(labels)
    .where(inArray(labels.id, allIds))

  return existingSegments.length === allIds.length
}
