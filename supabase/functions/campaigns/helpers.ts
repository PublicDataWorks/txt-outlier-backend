import supabase from '../_shared/lib/supabase.ts'
import { inArray } from 'drizzle-orm'
import { labels } from '../_shared/drizzle/schema.ts'
import { CampaignSegments, SegmentConfig } from './dto.ts'

const getAllSegmentIds = (config: SegmentConfig): string[] => {
  return config.flatMap((item) => {
    if (Array.isArray(item)) {
      return item.map((segment) => segment.id)
    }
    return [item.id]
  })
}

export const validateSegments = async (
  included?: SegmentConfig | null,
  excluded?: SegmentConfig | null,
): Promise<boolean> => {
  const includedIds = included ? getAllSegmentIds(included) : []
  const excludedIds = excluded ? getAllSegmentIds(excluded) : []
  const allIds = new Set([...includedIds, ...excludedIds])

  if (allIds.size === 0) {
    return true
  }

  const existingSegments = await supabase
    .select({ id: labels.id })
    .from(labels)
    .where(inArray(labels.id, Array.from(allIds)))

  return existingSegments.length === allIds.size
}

export const addReplyLabelToExcluded = (segments: CampaignSegments) => {
  const MISSIVE_REPLY_LABEL_ID = Deno.env.get('MISSIVE_REPLY_LABEL_ID');

  if (!MISSIVE_REPLY_LABEL_ID) {
    return segments;
  }

  const updatedSegments = { ...segments };

  if (!updatedSegments.excluded) {
    updatedSegments.excluded = [{ id: MISSIVE_REPLY_LABEL_ID }];
  } else {
    const hasReplyLabel = updatedSegments.excluded.some(
      (item) => !Array.isArray(item) && item.id === MISSIVE_REPLY_LABEL_ID
    );

    if (!hasReplyLabel) {
      updatedSegments.excluded = [...updatedSegments.excluded, { id: MISSIVE_REPLY_LABEL_ID }];
    }
  }

  return updatedSegments;
};
