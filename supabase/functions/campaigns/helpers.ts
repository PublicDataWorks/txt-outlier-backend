import supabase from '../_shared/lib/supabase.ts'
import { inArray } from 'drizzle-orm'
import { labels } from '../_shared/drizzle/schema.ts'
import { SegmentConfig } from './dto.ts'

const getAllSegmentIds = (config: SegmentConfig): string[] => {
  if (!Array.isArray(config)) {
    return [config.id];
  }

  return config.flatMap(item => {
    if (Array.isArray(item)) {
      return item.map(segment => segment.id);
    }
    return [item.id];
  });
};

export const validateSegments = async (
  included?: SegmentConfig | null,
  excluded?: SegmentConfig | null,
): Promise<boolean> => {
  const includedIds = included ? getAllSegmentIds(included) : []
  const excludedIds = excluded ? getAllSegmentIds(excluded) : []
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
