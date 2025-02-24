import { SegmentConfig } from './dto.ts'
import supabase from "../_shared/lib/supabase.ts";
import { campaignSegments } from "../_shared/drizzle/schema.ts";
import { inArray } from "drizzle-orm";

export const getAllSegmentIds = (config: SegmentConfig): number[] => {
  if (typeof config === 'number') {
    return [config]
  }
  return config.flatMap(item => Array.isArray(item) ? item : [item])
}

export const validateSegments = async (segments: SegmentConfig): Promise<boolean> => {
  const segmentIds = getAllSegmentIds(segments)
  const existingSegments = await supabase
    .select({ id: campaignSegments.id })
    .from(campaignSegments)
    .where(inArray(campaignSegments.id, segmentIds))

  return existingSegments.length === segmentIds.length
}
