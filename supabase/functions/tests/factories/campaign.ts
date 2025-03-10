import { faker } from 'faker'
import { campaigns } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { createLabel } from './label.ts'

export type CreateCampaignParams = {
  title?: string | null
  firstMessage?: string
  secondMessage?: string | null
  runAt?: Date
  includedSegment?: string
  excludedSegment?: string
}

export const createCampaign = async ({
  title = null,
  firstMessage,
  secondMessage = null,
  runAt,
  includedSegment,
  excludedSegment,
}: CreateCampaignParams = {}) => {
  // Create a default label if includedSegments is not provided
  const defaultLabel = includedSegment ? null : await createLabel()

  const campaign = {
    title,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage,
    runAt: runAt || new Date(Date.now() + 86400000), // tomorrow
    segments: {
      included: [{ id: includedSegment || defaultLabel!.id }],
      excluded: [{ id: excludedSegment }],
    },
  }

  const [result] = await supabase
    .insert(campaigns)
    .values(campaign)
    .returning()

  return result
}
