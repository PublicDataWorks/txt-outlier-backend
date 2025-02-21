// factories/campaign.ts
import { faker } from 'faker'
import { campaigns } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export type CreateCampaignParams = {
  title?: string
  firstMessage?: string
  secondMessage?: string
  runAt?: Date
}

export const createCampaign = async ({
  title,
  firstMessage,
  secondMessage,
  runAt,
}: CreateCampaignParams = {}) => {
  const campaign = {
    title: title,
    firstMessage: firstMessage || faker.lorem.sentence(),
    secondMessage: secondMessage,
    runAt: runAt || new Date(Date.now() + 86400000), // tomorrow
  }

  const [result] = await supabase
    .insert(campaigns)
    .values(campaign)
    .returning()

  return result
}
