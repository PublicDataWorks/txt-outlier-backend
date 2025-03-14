import { faker } from 'faker'
import { campaigns } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { createLabel } from './label.ts'

export type CreateCampaignParams = {
  title?: string | null
  firstMessage?: string
  secondMessage?: string | null
  runAt?: Date
  includedSegments?: string[]
  processed?: boolean
}

export const createCampaign = async ({
  title = null,
  firstMessage,
  secondMessage = null,
  runAt,
  includedSegments,
  processed = false,
}: CreateCampaignParams = {}) => {
  // Create a default label if includedSegments is not provided
  const defaultLabel = includedSegments ? null : await createLabel()

  const campaign = {
    title,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage,
    runAt: runAt || new Date(Date.now() + 86400000), // tomorrow
    segments: {
      included: [{ id: includedSegments || defaultLabel!.id }],
    },
    processed,
  }

  const [result] = await supabase
    .insert(campaigns)
    .values(campaign)
    .returning()

  return result
}
